import * as THREE from "three";
import {
  ANIM,
  IDEA_MSG,
  MSG,
  NET,
  PLAYER,
  REPO_URL,
  type Anim,
  type ChatBroadcast,
  type Idea,
  type JoinOptions,
  type MoveMessage,
  type NoticeMessage,
} from "@vi/shared";
import { createWorld } from "./world/scene";
import { Avatar } from "./world/avatar";
import { Controls } from "./world/controls";
import { IdeaWall } from "./world/ideaWall";
import { joinHub, serverUrl, waitForServer, type HubCallbacks, type HubRoom } from "./net/connection";
import { Voice } from "./voice/voice";
import { Hud, JoinScreen } from "./ui/hud";
import { IdeasPanel } from "./ui/ideas";

const world = createWorld(document.getElementById("world")!, document.getElementById("labels")!);
const controls = new Controls(world.renderer.domElement);
const joinScreen = new JoinScreen();
const hud = new Hud();
const ideasPanel = new IdeasPanel();
// Between the north and east paths, facing the fountain.
const ideaWall = new IdeaWall(world.scene, world.colliders, 12.5, -12.5);

(document.getElementById("source-link") as HTMLAnchorElement).href = REPO_URL;
ideasPanel.onOpenChange = (open) => (controls.blocked = open);
document.getElementById("ideas-open")!.addEventListener("click", () => session && ideasPanel.open());
window.addEventListener("keydown", (e) => {
  if (!session || controls.blocked) return;
  if (e.code === "KeyE" && ideaWall.isNear(session.me.position)) {
    e.preventDefault();
    ideasPanel.open();
  }
  if (e.code === "KeyM") {
    e.preventDefault();
    toggleMic();
  }
});

function toggleMic() {
  if (!session) return;
  if (session.voice.isOn) session.voice.toggleMuted();
  else void session.voice.start();
}
hud.onMicClick = toggleMic;

interface Remote {
  avatar: Avatar;
  target: { x: number; z: number; rot: number };
}

interface Sent {
  x: number;
  z: number;
  rot: number;
  anim: Anim;
  at: number;
}

interface Session {
  room: HubRoom;
  me: Avatar;
  remotes: Map<string, Remote>;
  voice: Voice;
  lastSent: Sent;
  /** The last few positions we sent, to recognise the server's echo of them. */
  sentHistory: Sent[];
  sendAccumulator: number;
  startedAt: number;
}

let session: Session | undefined;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

async function main() {
  // Keep offering the join screen: after a disconnect you can come straight back.
  for (;;) {
    const options = await joinScreen.waitForSubmit();
    joinScreen.setBusy(true, "Connecting…");
    try {
      await waitForServer((text) => joinScreen.setBusy(true, text));
      joinScreen.setBusy(true, "Entering the hub…");
      const { room, callbacks, myId } = await joinHub(options);
      joinScreen.hide();
      hud.show();
      const reason = await runSession(room, callbacks, options, myId);
      hud.hide();
      joinScreen.show();
      joinScreen.setError(reason);
    } catch (err) {
      console.error(err);
      joinScreen.setError(`Could not reach the world server at ${serverUrl()}. Is it running? (npm run dev)`);
    }
  }
}

/** Resolves with a human-readable reason when the room connection ends. */
function runSession(room: HubRoom, callbacks: HubCallbacks, options: JoinOptions, myId: string): Promise<string> {
  return new Promise((resolve) => {
    const remotes = new Map<string, Remote>();
    const me = new Avatar(options.name || "You", options.color, true);
    world.scene.add(me.group);

    const voice = new Voice(room, {
      myPosition: () => me.position,
      listenerYaw: () => controls.yaw,
      peerPosition: (id) => remotes.get(id)?.avatar.position,
    });
    voice.onStatus = (status) => {
      hud.setMic(status, voice.listeners);
      me.setMic(status === "on");
    };
    voice.onSpeaking = (id, speaking) => {
      (id === "me" ? me : remotes.get(id)?.avatar)?.setSpeaking(speaking);
    };
    hud.setMic("off");

    const s: Session = (session = {
      room,
      me,
      remotes,
      voice,
      lastSent: { x: NaN, z: NaN, rot: NaN, anim: ANIM.idle, at: 0 },
      sentHistory: [],
      sendAccumulator: 0,
      startedAt: performance.now(),
    });

    const updateCount = () => hud.setCount(room.state.players.size);

    callbacks.onAdd("players", (player, id) => {
      if (id === room.sessionId) {
        // The server decided where we spawn and what we're called.
        me.position.set(player.x, 0, player.z);
        me.rot = player.rot;
        me.setName(player.name);
        controls.yaw = player.rot + Math.PI; // camera behind us
        callbacks.onChange(player, () => {
          // If the echoed position matches something we sent, all is well.
          // Otherwise the server corrected us (too fast, out of bounds): snap.
          const echoed = s.sentHistory.some((p) => Math.abs(p.x - player.x) < 0.05 && Math.abs(p.z - player.z) < 0.05);
          if (!echoed && s.sentHistory.length > 0) {
            me.position.set(player.x, 0, player.z);
            s.sentHistory.length = 0;
          }
        });
        updateCount();
        return;
      }
      const avatar = new Avatar(player.name, player.color);
      avatar.position.set(player.x, 0, player.z);
      avatar.rot = player.rot;
      avatar.anim = player.anim as Anim;
      world.scene.add(avatar.group);
      avatar.setMic(player.mic === 1);
      const remote: Remote = { avatar, target: { x: player.x, z: player.z, rot: player.rot } };
      remotes.set(id, remote);
      callbacks.onChange(player, () => {
        remote.target.x = player.x;
        remote.target.z = player.z;
        remote.target.rot = player.rot;
        avatar.anim = player.anim as Anim;
        avatar.setMic(player.mic === 1);
      });
      // People already here when we arrive are not "arriving".
      if (performance.now() - s.startedAt > 1500) hud.addSystem(`${player.name} arrived`);
      updateCount();
    });

    callbacks.onRemove("players", (player, id) => {
      const remote = remotes.get(id);
      if (remote) {
        remote.avatar.dispose();
        remotes.delete(id);
        hud.addSystem(`${player.name} left`);
      }
      updateCount();
    });

    room.onMessage(MSG.chat, (m: ChatBroadcast) => {
      const speaker = m.id === room.sessionId ? me : remotes.get(m.id)?.avatar;
      const color = m.id === room.sessionId ? options.color : room.state.players.get(m.id)?.color;
      speaker?.say(m.text);
      hud.addChat(m.name, m.text, color);
    });
    room.onMessage(MSG.notice, (m: NoticeMessage) => hud.addSystem(m.text));

    hud.onSend = (text) => room.send(MSG.chat, { text });
    hud.onFocusChange = (focused) => (controls.blocked = focused);

    // Idea Wall: load the list, then follow changes everyone makes.
    ideasPanel.bind(myId, {
      create: (title, details) => room.request<unknown, Idea>(IDEA_MSG.create, { title, details }),
      vote: (id) => room.request<unknown, Idea>(IDEA_MSG.vote, { id }),
      join: (id) => room.request<unknown, Idea>(IDEA_MSG.join, { id }),
      leave: (id) => room.request<unknown, Idea>(IDEA_MSG.leave, { id }),
      setStatus: (id, status) => room.request<unknown, Idea>(IDEA_MSG.status, { id, status }),
    });
    room.onMessage(IDEA_MSG.changed, (idea: Idea) => {
      ideasPanel.upsert(idea);
      ideaWall.upsert(idea);
    });
    room
      .request<unknown, Idea[]>(IDEA_MSG.list)
      .then((list) => {
        ideasPanel.setIdeas(list);
        ideaWall.setIdeas(list);
      })
      .catch((err) => console.warn("could not load ideas", err));

    const end = (reason: string) => {
      voice.dispose();
      hud.setMic("off");
      for (const r of remotes.values()) r.avatar.dispose();
      remotes.clear();
      me.dispose();
      ideasPanel.unbind();
      ideaWall.setNear(false);
      session = undefined;
      controls.blocked = false;
      resolve(reason);
    };

    room.onError((code, message) => {
      console.error("room error", code, message);
      hud.addSystem(`Connection problem: ${message ?? code}`);
    });
    room.onLeave((code) => end(code === 1000 || code === 4000 ? "You left the hub." : `Disconnected from the hub (code ${code}).`));

    hud.addSystem("Welcome. WASD to walk, Shift to run, Enter to chat, M to turn on your mic.");
  });
}

// ---- Render loop -----------------------------------------------------------

const moveVec = new THREE.Vector2();
const camTarget = new THREE.Vector3();
let last = performance.now();
let lastMicLabel = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (session) {
    stepLocal(session, dt);
    stepRemotes(session, dt);
    camTarget.set(session.me.position.x, 1.5, session.me.position.z);
    controls.updateCamera(world.camera, camTarget);
    maybeSend(session, dt);
    ideaWall.setNear(ideaWall.isNear(session.me.position));
    session.voice.update(now);
    if (session.voice.status === "on" && now - lastMicLabel > 1000) {
      lastMicLabel = now;
      hud.setMic("on", session.voice.listeners);
    }
  } else {
    // Idle: drift slowly around the fountain behind the join screen.
    controls.yaw += dt * 0.08;
    controls.pitch = 0.4;
    controls.distance = 22;
    camTarget.set(0, 2.5, 0);
    controls.updateCamera(world.camera, camTarget);
  }

  world.render();
  requestAnimationFrame(frame);
}

function stepLocal(s: Session, dt: number) {
  const mv = controls.moveVector(moveVec);
  const moving = mv.lengthSq() > 0;
  if (moving) {
    const speed = controls.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    s.me.position.x += mv.x * speed * dt;
    s.me.position.z += mv.y * speed * dt;
    const want = Math.atan2(mv.x, mv.y);
    s.me.rot = lerpAngle(s.me.rot, want, 1 - Math.exp(-dt * 14));
    s.me.anim = controls.running ? ANIM.run : ANIM.walk;
  } else {
    s.me.anim = ANIM.idle;
  }
  world.colliders.resolve(s.me.position, PLAYER.radius);
  s.me.update(dt);
}

function stepRemotes(s: Session, dt: number) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of s.remotes.values()) {
    const p = r.avatar.position;
    p.x += (r.target.x - p.x) * k;
    p.z += (r.target.z - p.z) * k;
    r.avatar.rot = lerpAngle(r.avatar.rot, r.target.rot, k);
    r.avatar.update(dt);
  }
}

/** Send our position at NET.sendHz when it changed, and at least once a second. */
function maybeSend(s: Session, dt: number) {
  s.sendAccumulator += dt;
  if (s.sendAccumulator < 1 / NET.sendHz) return;
  s.sendAccumulator = 0;

  const { x, z } = s.me.position;
  const rot = s.me.rot;
  const anim = s.me.anim;
  const ls = s.lastSent;
  const changed =
    Math.abs(x - ls.x) > 0.001 || Math.abs(z - ls.z) > 0.001 || Math.abs(rot - ls.rot) > 0.001 || anim !== ls.anim;
  const stale = performance.now() - ls.at > 1000;
  if (!changed && !stale) return;

  const msg: MoveMessage = { x, z, rot, anim };
  s.room.send(MSG.move, msg);
  s.lastSent = { x, z, rot, anim, at: performance.now() };
  s.sentHistory.push(s.lastSent);
  if (s.sentHistory.length > 8) s.sentHistory.shift();
}

requestAnimationFrame(frame);
main();
