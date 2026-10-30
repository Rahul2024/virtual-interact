import { Room, definePlugins, type Client } from "colyseus";
import { WebRTCPlugin } from "colyseus/plugins/webrtc";
import type { MessageContext } from "@colyseus/shared-types";
import {
  ANIM,
  ARCADE_MSG,
  BRICK_DUNGEON,
  CAMPFIRE_BASE,
  CINEMA_MSG,
  CINEMA_SEATS,
  FOOTBALL_MSG,
  FOOTBALL_STADIUM,
  FOREST_MSG,
  FRIEND_MSG,
  GRAFFITI_MURAL,
  IDEA_MSG,
  MSG,
  MURAL_MSG,
  NET,
  PLAYER,
  TEAM,
  TOOL,
  WORLD,
  clamp,
  isHexColor,
  isInBrickDungeon,
  isInCinemaHall,
  sanitizeChat,
  sanitizeName,
  type AnimalSpecies,
  type ArcadeMoveMessage,
  type ArcadeStateBroadcast,
  type ChatBroadcast,
  type ChatSend,
  type CinemaControlMessage,
  type CinemaSetDurationMessage,
  type CinemaSetUrlMessage,
  type CinemaSyncSeekBroadcast,
  type CinemaTransferHostMessage,
  type DungeonActionMessage,
  type EmoteBroadcast,
  type EmoteMessage,
  type FootballGoalBroadcast,
  type FootballKickMessage,
  type FootballTeamMessage,
  type ForestAttackMessage,
  type ForestEquipMessage,
  type FriendAcceptSend,
  type FriendIncomingMessage,
  type FriendRemoveSend,
  type FriendRequestSend,
  type FriendSyncedMessage,
  type Idea,
  type IdeaCreate,
  type IdeaRef,
  type IdeaStatusChange,
  type JoinOptions,
  type MicMessage,
  type MoveMessage,
  type MuralInitMessage,
  type MuralPaintMessage,
  type NoticeMessage,
  type SeatMessage,
} from "@vi/shared";
import { ForestAnimal, HubState, Player } from "./HubState.js";
import { ideas, ideasReady, IdeaRejected } from "../ideas/index.js";

interface Session {
  lastMoveAt: number;
  lastChatAt: number;
  lastTrapHitAt: number;
  lastSnakeBiteAt: number;
  mimicStruggles: number;
  clientId: string;
  enteredCinemaAt: number;
  joinedAt: number;
}

interface AnimalBrain {
  id: string;
  species: AnimalSpecies;
  homeXMin: number;
  homeXMax: number;
  homeZMin: number;
  homeZMax: number;
  speed: number;
  vx: number;
  vz: number;
  changeDirAt: number;
  respawnAt: number;
}

const SPEED_SLACK = 1.6;

const friendGraph = new Map<string, Set<string>>();

function getFriendsSet(clientId: string): Set<string> {
  let set = friendGraph.get(clientId);
  if (!set) {
    set = new Set<string>();
    friendGraph.set(clientId, set);
  }
  return set;
}

export class HubRoom extends Room<{ state: HubState }> {
  override maxClients = 100;
  override patchRate = NET.patchMs;
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;
  override autoDispose = true;

  override state = new HubState();

  override plugins = definePlugins([new WebRTCPlugin()]);

  private sessions = new Map<string, Session>();

  private muralPixels: number[] = new Array(GRAFFITI_MURAL.width * GRAFFITI_MURAL.height).fill(0);

  private ballVx = 0;
  private ballVz = 0;
  private lastTouchName = "Player";

  private c4Board: number[] = new Array(42).fill(0);
  private c4Turn: 1 | 2 = 1;
  private c4Winner = 0;
  private tttBoard: number[] = new Array(9).fill(0);
  private tttTurn: 1 | 2 = 1;
  private tttWinner = 0;
  private triviaIdx = 0;
  private triviaScores: Record<string, number> = {};

  private animalBrains = new Map<string, AnimalBrain>();
  private dungeonResetTimer: ReturnType<typeof setTimeout> | undefined;

  override messages = {
    [MSG.move]: (client: Client, payload: MoveMessage) => this.onMove(client, payload),
    [MSG.chat]: (client: Client, payload: ChatSend) => this.onChat(client, payload),
    [MSG.mic]: (client: Client, payload: MicMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.mic = payload?.on ? 1 : 0;
    },
    [MSG.seat]: (client: Client, payload: SeatMessage) => this.onSeat(client, payload),
    [MSG.emote]: (client: Client, payload: EmoteMessage) => this.onEmote(client, payload),

    // Friend Requests & Social Privacy
    [FRIEND_MSG.request]: (client: Client, payload: FriendRequestSend) => this.onFriendRequest(client, payload),
    [FRIEND_MSG.accept]: (client: Client, payload: FriendAcceptSend) => this.onFriendAccept(client, payload),
    [FRIEND_MSG.remove]: (client: Client, payload: FriendRemoveSend) => this.onFriendRemove(client, payload),

    // Cinema Hall controls (Host-only link play, duration sync & seek!)
    [CINEMA_MSG.setUrl]: (client: Client, payload: CinemaSetUrlMessage) => this.onCinemaSetUrl(client, payload),
    [CINEMA_MSG.setDuration]: (client: Client, payload: CinemaSetDurationMessage) =>
      this.onCinemaSetDuration(client, payload),
    [CINEMA_MSG.control]: (client: Client, payload: CinemaControlMessage) => this.onCinemaControl(client, payload),
    [CINEMA_MSG.transferHost]: (client: Client, payload: CinemaTransferHostMessage) =>
      this.onCinemaTransferHost(client, payload),

    // Shared Pixel Graffiti Mural
    [MURAL_MSG.paint]: (client: Client, payload: MuralPaintMessage) => this.onMuralPaint(client, payload),
    [MURAL_MSG.clear]: (client: Client) => this.onMuralClear(client),

    // West Team Football Stadium
    [FOOTBALL_MSG.joinTeam]: (client: Client, payload: FootballTeamMessage) => this.onFootballJoinTeam(client, payload),
    [FOOTBALL_MSG.kick]: (client: Client, payload: FootballKickMessage) => this.onFootballKick(client, payload),
    [FOOTBALL_MSG.resetMatch]: (client: Client) => this.onFootballReset(client),

    // East Multiplayer Arcade
    [ARCADE_MSG.move]: (client: Client, payload: ArcadeMoveMessage) => this.onArcadeMove(client, payload),
    [ARCADE_MSG.reset]: (_client: Client, payload: { game?: string }) => this.onArcadeReset(payload?.game),

    // South Campfire, Deep Forest Survival & Frieren Brick Dungeon
    [FOREST_MSG.equipTool]: (client: Client, payload: ForestEquipMessage) => this.onForestEquip(client, payload),
    [FOREST_MSG.attackAnimal]: (client: Client, payload: ForestAttackMessage) => this.onForestAttack(client, payload),
    [FOREST_MSG.forageBerry]: (client: Client) => this.onForestForage(client),
    [FOREST_MSG.cookMeat]: (client: Client) => this.onForestCook(client),
    [FOREST_MSG.eatMeat]: (client: Client) => this.onForestEat(client),
    [FOREST_MSG.dungeonAction]: (client: Client, payload: DungeonActionMessage) =>
      this.onDungeonAction(client, payload),

    // Idea Wall
    [IDEA_MSG.list]: (): Idea[] => ideas.list(),
    [IDEA_MSG.create]: (client: Client, payload: IdeaCreate, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.create(who, { title: payload?.title, details: payload?.details })),
    [IDEA_MSG.vote]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.vote(who, payload?.id)),
    [IDEA_MSG.join]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.join(who, payload?.id)),
    [IDEA_MSG.leave]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.leave(who, payload?.id)),
    [IDEA_MSG.status]: (client: Client, payload: IdeaStatusChange, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.setStatus(who, payload?.id, payload?.status)),
  };

  override async onCreate(): Promise<void> {
    await ideasReady;
    this.state.movieUrl = "";
    this.state.movieDurationSec = 0;
    this.state.movieStartedAt = 0;
    this.state.moviePaused = 0;
    this.state.moviePausedAtSec = 0;
    this.state.dungeonWing = 1;
    this.state.dungeonSeed = 0;
    this.state.grimoireFound = 0;
    this.state.gateLeftOpen = 0;
    this.state.gateRightOpen = 0;
    this.state.vaultUnlocked = 0;
    this.state.arrowVolleyZ = BRICK_DUNGEON.hall1EndZ;

    this.seedInitialMuralArt();
    this.spawnForestAnimals();

    this.setSimulationInterval((dtMs) => this.tickWorld(dtMs / 1000), 50);

    console.log(`[hub] room ${this.roomId} created`);
  }

  private seedInitialMuralArt() {
    const w = GRAFFITI_MURAL.width;
    for (let y = 0; y < GRAFFITI_MURAL.height; y++) {
      for (let x = 0; x < w; x++) {
        if (y === 0 || y === GRAFFITI_MURAL.height - 1 || x === 0 || x === w - 1) {
          this.muralPixels[y * w + x] = 7;
        } else if (y >= 5 && y <= 10 && (x + y) % 5 === 0) {
          this.muralPixels[y * w + x] = 2 + ((x * 3 + y) % 8);
        }
      }
    }
  }

  private spawnForestAnimals() {
    const specs: Array<{
      id: string;
      species: AnimalSpecies;
      xMin: number;
      xMax: number;
      zMin: number;
      zMax: number;
      hp: number;
      speed: number;
    }> = [
      { id: "rabbit-1", species: "rabbit", xMin: -65, xMax: -18, zMin: 78, zMax: 110, hp: 1, speed: 3.4 },
      { id: "rabbit-2", species: "rabbit", xMin: 18, xMax: 65, zMin: 82, zMax: 115, hp: 1, speed: 3.4 },
      { id: "deer-1", species: "deer", xMin: -75, xMax: -20, zMin: 86, zMax: 135, hp: 2, speed: 3.0 },
      { id: "deer-2", species: "deer", xMin: 20, xMax: 75, zMin: 90, zMax: 140, hp: 2, speed: 3.0 },
      { id: "boar-1", species: "boar", xMin: -80, xMax: -22, zMin: 98, zMax: 155, hp: 3, speed: 2.6 },
      { id: "boar-2", species: "boar", xMin: 22, xMax: 80, zMin: 105, zMax: 160, hp: 3, speed: 2.6 },
      { id: "wolf-1", species: "wolf", xMin: -85, xMax: -24, zMin: 128, zMax: 185, hp: 4, speed: 3.6 },
      { id: "wolf-2", species: "wolf", xMin: 24, xMax: 85, zMin: 135, zMax: 190, hp: 4, speed: 3.6 },
      // Slithering Forest Snakes & Vipers
      { id: "snake-1", species: "snake", xMin: -65, xMax: -18, zMin: 85, zMax: 150, hp: 2, speed: 3.3 },
      { id: "snake-2", species: "snake", xMin: 18, xMax: 65, zMin: 85, zMax: 150, hp: 2, speed: 3.5 },
      { id: "snake-3", species: "snake", xMin: -55, xMax: -16, zMin: 118, zMax: 175, hp: 1, speed: 3.2 },
      { id: "snake-4", species: "snake", xMin: 16, xMax: 55, zMin: 118, zMax: 175, hp: 2, speed: 3.4 },
    ];
    for (const s of specs) {
      const animal = new ForestAnimal();
      animal.id = s.id;
      animal.species = s.species;
      animal.x = s.xMin + Math.random() * (s.xMax - s.xMin);
      animal.z = s.zMin + Math.random() * (s.zMax - s.zMin);
      animal.rot = Math.random() * Math.PI * 2;
      animal.hp = s.hp;
      animal.maxHp = s.hp;
      this.state.animals.set(s.id, animal);
      this.animalBrains.set(s.id, {
        id: s.id,
        species: s.species,
        homeXMin: s.xMin,
        homeXMax: s.xMax,
        homeZMin: s.zMin,
        homeZMax: s.zMax,
        speed: s.speed,
        vx: 0,
        vz: 0,
        changeDirAt: Date.now() + Math.random() * 3000,
        respawnAt: 0,
      });
    }
  }

  private tickWorld(dt: number) {
    this.tickFootball(dt);
    this.tickAnimals(dt);
    this.tickBrickDungeon(dt);
  }

  private tickFootball(dt: number) {
    const cx = FOOTBALL_STADIUM.centerX;
    const cz = FOOTBALL_STADIUM.centerZ;
    const minX = cx - FOOTBALL_STADIUM.halfW;
    const maxX = cx + FOOTBALL_STADIUM.halfW;
    const minZ = cz - FOOTBALL_STADIUM.halfD;
    const maxZ = cz + FOOTBALL_STADIUM.halfD;

    for (const p of this.state.players.values()) {
      if (p.seatId >= 0) continue;
      const dx = this.state.ballX - p.x;
      const dz = this.state.ballZ - p.z;
      const d = Math.hypot(dx, dz);
      const minDist = PLAYER.radius + FOOTBALL_STADIUM.ballRadius + 0.25;
      if (d < minDist && d > 0.001) {
        const nx = dx / d;
        const nz = dz / d;
        const impulse = p.anim === ANIM.run ? 11.5 : 7.5;
        this.ballVx = nx * impulse;
        this.ballVz = nz * impulse;
        this.lastTouchName = p.name;
      }
    }

    if (Math.abs(this.ballVx) > 0.02 || Math.abs(this.ballVz) > 0.02) {
      let bx = this.state.ballX + this.ballVx * dt;
      let bz = this.state.ballZ + this.ballVz * dt;

      const drag = Math.exp(-dt * 1.85);
      this.ballVx *= drag;
      this.ballVz *= drag;

      const inGoalZ = Math.abs(bz - cz) <= FOOTBALL_STADIUM.goalHalfZ;
      if (bx <= minX && inGoalZ) {
        this.state.scoreBlue = Math.min(99, this.state.scoreBlue + 1);
        this.resetBallToCenter();
        this.broadcast(FOOTBALL_MSG.goal, {
          scoringTeam: "blue",
          scorerName: this.lastTouchName,
          scoreRed: this.state.scoreRed,
          scoreBlue: this.state.scoreBlue,
        } satisfies FootballGoalBroadcast);
        this.broadcast(MSG.notice, {
          text: `⚽ GOAL for Blue Team by ${this.lastTouchName}! Score: Red ${this.state.scoreRed} – ${this.state.scoreBlue} Blue`,
        } satisfies NoticeMessage);
        return;
      }
      if (bx >= maxX && inGoalZ) {
        this.state.scoreRed = Math.min(99, this.state.scoreRed + 1);
        this.resetBallToCenter();
        this.broadcast(FOOTBALL_MSG.goal, {
          scoringTeam: "red",
          scorerName: this.lastTouchName,
          scoreRed: this.state.scoreRed,
          scoreBlue: this.state.scoreBlue,
        } satisfies FootballGoalBroadcast);
        this.broadcast(MSG.notice, {
          text: `⚽ GOAL for Red Team by ${this.lastTouchName}! Score: Red ${this.state.scoreRed} – ${this.state.scoreBlue} Blue`,
        } satisfies NoticeMessage);
        return;
      }

      if (bx < minX) {
        bx = minX;
        this.ballVx = Math.abs(this.ballVx) * 0.75;
      } else if (bx > maxX) {
        bx = maxX;
        this.ballVx = -Math.abs(this.ballVx) * 0.75;
      }
      if (bz < minZ) {
        bz = minZ;
        this.ballVz = Math.abs(this.ballVz) * 0.75;
      } else if (bz > maxZ) {
        bz = maxZ;
        this.ballVz = -Math.abs(this.ballVz) * 0.75;
      }

      this.state.ballX = bx;
      this.state.ballZ = bz;
    }
  }

  private resetBallToCenter() {
    this.state.ballX = FOOTBALL_STADIUM.centerX;
    this.state.ballZ = FOOTBALL_STADIUM.centerZ;
    this.ballVx = 0;
    this.ballVz = 0;
  }

  private tickAnimals(dt: number) {
    const now = Date.now();
    for (const [id, brain] of this.animalBrains.entries()) {
      const animal = this.state.animals.get(id);
      if (!animal) continue;

      if (animal.hp === 0) {
        if (now >= brain.respawnAt) {
          animal.hp = animal.maxHp;
          animal.x = brain.homeXMin + Math.random() * (brain.homeXMax - brain.homeXMin);
          animal.z = brain.homeZMin + Math.random() * (brain.homeZMax - brain.homeZMin);
        }
        continue;
      }

      if (brain.species === "snake") {
        let nearestPlayer: { sid: string; p: Player; d: number } | undefined;
        for (const [sid, p] of this.state.players.entries()) {
          if (p.seatId >= 0) continue;
          const d = Math.hypot(p.x - animal.x, p.z - animal.z);
          if (d < 7.5 && (!nearestPlayer || d < nearestPlayer.d)) {
            nearestPlayer = { sid, p, d };
          }
        }
        if (nearestPlayer) {
          const { sid, p, d } = nearestPlayer;
          if (d > 0.3) {
            brain.vx = ((p.x - animal.x) / d) * brain.speed * 0.82;
            brain.vz = ((p.z - animal.z) / d) * brain.speed * 0.82;
            animal.rot = Math.atan2(brain.vx, brain.vz);
          }
          if (d < 1.35) {
            const sess = this.sessions.get(sid);
            if (sess && now - sess.lastSnakeBiteAt > 4500) {
              sess.lastSnakeBiteAt = now;
              p.energy = Math.max(10, p.energy - 15);
              const cl = this.clients.find((c) => c.sessionId === sid);
              cl?.send(MSG.notice, {
                text: "🐍 Bitten by a venomous forest viper! (-15 Energy — press SPACE with a Spear/Bow to hunt it!)",
              } satisfies NoticeMessage);
            }
          }
        }
      }

      if (now >= brain.changeDirAt) {
        brain.changeDirAt = now + 2200 + Math.random() * 3200;
        if (Math.random() < 0.25) {
          brain.vx = 0;
          brain.vz = 0;
        } else {
          const angle = Math.random() * Math.PI * 2;
          brain.vx = Math.cos(angle) * brain.speed * 0.55;
          brain.vz = Math.sin(angle) * brain.speed * 0.55;
          animal.rot = Math.atan2(brain.vx, brain.vz);
        }
      }

      let nx = animal.x + brain.vx * dt;
      let nz = animal.z + brain.vz * dt;
      if (nx < brain.homeXMin || nx > brain.homeXMax) {
        brain.vx = -brain.vx;
        nx = clamp(nx, brain.homeXMin, brain.homeXMax);
      }
      if (nz < brain.homeZMin || nz > brain.homeZMax) {
        brain.vz = -brain.vz;
        nz = clamp(nz, brain.homeZMin, brain.homeZMax);
      }
      if (Math.hypot(nx - CAMPFIRE_BASE.x, nz - CAMPFIRE_BASE.z) < 13) {
        nz = CAMPFIRE_BASE.z + 14;
        brain.vz = Math.abs(brain.vz);
      }
      animal.x = nx;
      animal.z = nz;
    }
  }

  /**
   * Server-side simulation of the Frieren-Style Square Stone-Brick Dungeon:
   * - Hallway 1 (`z = 122..145`): Cracked Flagstone Bricks (*CLICK!* spike/dart trap) + Wall Arrow-Slit Volley
   * - Junction 1 (`z = 148..154`): Shifting Brick Partition Wall (West vs East Wing)
   * - Secret Bookcase Wall (`z = 174`): Blocks access to Parallel Hallways until the Grimoire Key Chest is found!
   * - Parallel Iron-Bar Hallways (`z = 175..192`): Left & Right Iron Portcullis Gates at `z = 188`
   */
  private tickBrickDungeon(dt: number) {
    let az = this.state.arrowVolleyZ - 11.0 * dt;
    if (az < BRICK_DUNGEON.startZ + 2) {
      az = BRICK_DUNGEON.hall1EndZ;
    }
    this.state.arrowVolleyZ = az;

    const now = Date.now();
    const cx = BRICK_DUNGEON.centerX;

    for (const [sid, p] of this.state.players.entries()) {
      if (!isInBrickDungeon(p.x, p.z)) {
        if (p.mimicTrapped !== 0) p.mimicTrapped = 0;
        continue;
      }
      const sess = this.sessions.get(sid);
      if (!sess || now - sess.lastTrapHitAt < 1600) continue;

      // 1. Hallway 1 (z = 124..145): Cracked Floor Brick Slabs & Wall-Slit Arrow Volleys
      if (p.z >= 124 && p.z <= BRICK_DUNGEON.hall1EndZ) {
        // Check 4 rows of Cracked Floor Bricks at z = 127, 132, 137, 142
        const rows = [127, 132, 137, 142];
        for (let r = 0; r < rows.length; r++) {
          const rz = rows[r]!;
          if (Math.abs(p.z - rz) < 1.05) {
            const crackedOnLeft = (r + this.state.dungeonSeed) % 2 === 0;
            const trapX = crackedOnLeft ? cx - 2.1 : cx + 2.1;
            if (Math.abs(p.x - trapX) < 1.55) {
              sess.lastTrapHitAt = now;
              p.z = BRICK_DUNGEON.startZ + 2;
              p.energy = Math.max(10, p.energy - 18);
              const cl = this.clients.find((c) => c.sessionId === sid);
              cl?.send(MSG.notice, {
                text: "🧱 *CLICK!* You stepped on a cracked floor brick — iron floor spikes & wall darts knocked you back! (-18 Energy — use a 🔥 Torch to spot the cracks!)",
              } satisfies NoticeMessage);
              break;
            }
          }
        }

        // Check sweeping Wall-Slit Arrow Volley (recessed brick wall niches at |x - cx| > 4.6 are safe!)
        const inWallNiche = Math.abs(p.x - cx) > 4.5;
        if (!inWallNiche && Math.abs(p.z - this.state.arrowVolleyZ) < 1.1 && Math.abs(p.x - cx) < 2.2) {
          sess.lastTrapHitAt = now;
          p.z = Math.max(BRICK_DUNGEON.startZ + 2, p.z - 5);
          p.energy = Math.max(10, p.energy - 15);
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "🏹 Hit by the Hallway Arrow Volley! Step into the recessed brick wall niches as arrows fly past (-15 Energy).",
          } satisfies NoticeMessage);
          continue;
        }
      }

      // 2. Shifting Brick Partition Wall at z = 151..156 (blocks the unchosen wing)
      if (p.z >= 150.5 && p.z <= 156) {
        const inWestWing = p.x < cx;
        const westOpen = this.state.dungeonWing === 1;
        if ((inWestWing && !westOpen) || (!inWestWing && westOpen)) {
          sess.lastTrapHitAt = now;
          p.z = BRICK_DUNGEON.junctionZ - 1.0;
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: `🧱 That brick wing is sealed! Walk through the open ${westOpen ? "West (Left)" : "East (Right)"} archway or pull the T-Junction Lever to shift the walls!`,
          } satisfies NoticeMessage);
          continue;
        }
      }

      // 3. Secret Brick Bookcase Wall at z = 174 (blocks passage until the Grimoire Key Chest is opened!)
      if (p.z >= BRICK_DUNGEON.secretWallZ - 0.8 && this.state.grimoireFound === 0) {
        sess.lastTrapHitAt = now;
        p.z = BRICK_DUNGEON.secretWallZ - 2.0;
        const cl = this.clients.find((c) => c.sessionId === sid);
        cl?.send(MSG.notice, {
          text: "📚 A solid brick bookcase blocks the way! Find the real Grimoire Key inside one of the 3 Chests (watch out for Mimics!).",
        } satisfies NoticeMessage);
        continue;
      }

      // 4. Parallel Iron Portcullis Gates at z = 188
      if (p.z >= BRICK_DUNGEON.gateZ - 0.8 && p.z <= BRICK_DUNGEON.gateZ + 1.5) {
        const onLeft = p.x < cx;
        if ((onLeft && this.state.gateLeftOpen === 0) || (!onLeft && this.state.gateRightOpen === 0)) {
          sess.lastTrapHitAt = now;
          p.z = BRICK_DUNGEON.gateZ - 2.0;
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "⛓️ The Iron Portcullis Gate is locked! Press the Loose Brick Switch on the wall (or have your friend on the other side press theirs) to raise it!",
          } satisfies NoticeMessage);
        }
      }
    }
  }

  override onJoin(client: Client, options: Partial<JoinOptions> | undefined): void {
    const player = new Player();
    player.name = sanitizeName(options?.name);
    player.color = isHexColor(options?.color) ? options.color : "#5b8def";

    const rawId = options?.clientId;
    const clientId =
      typeof rawId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(rawId) ? `c:${rawId}` : `s:${client.sessionId}`;
    player.clientId = clientId;

    const angle = Math.random() * Math.PI * 2;
    const radius = 7 + Math.random() * 3;
    player.x = Math.cos(angle) * radius;
    player.z = Math.sin(angle) * radius;
    player.rot = Math.atan2(-player.x, -player.z);
    player.anim = ANIM.idle;
    player.seatId = -1;
    player.tool = TOOL.none;
    player.team = TEAM.none;
    player.rawMeat = 0;
    player.cookedMeat = 1;
    player.energy = 85;
    player.mimicTrapped = 0;

    const now = Date.now();
    this.state.players.set(client.sessionId, player);
    this.sessions.set(client.sessionId, {
      lastMoveAt: now,
      lastChatAt: 0,
      lastTrapHitAt: 0,
      lastSnakeBiteAt: 0,
      mimicStruggles: 0,
      clientId,
      enteredCinemaAt: 0,
      joinedAt: now,
    });

    this.evaluateCinemaHost();
    this.syncFriendsToClient(client, clientId);
    client.send(MURAL_MSG.init, { pixels: this.muralPixels } satisfies MuralInitMessage);
    client.send(ARCADE_MSG.state, this.getArcadeState());

    console.log(`[hub] ${player.name} joined (${this.clients.length} in room)`);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (this.state.cinemaHostId === client.sessionId) {
      this.state.cinemaHostId = "";
      this.state.cinemaHostName = "";
    }
    this.evaluateCinemaHost(true);
    console.log(`[hub] ${player?.name ?? client.sessionId} left (${this.clients.length} in room)`);
  }

  override onDispose(): void {
    if (this.dungeonResetTimer) clearTimeout(this.dungeonResetTimer);
    console.log(`[hub] room ${this.roomId} disposed`);
  }

  private onMuralPaint(_client: Client, payload: MuralPaintMessage): void {
    const x = Math.trunc(payload?.x ?? -1);
    const y = Math.trunc(payload?.y ?? -1);
    const colorIdx = Math.trunc(payload?.colorIdx ?? 0);
    if (
      x < 0 ||
      x >= GRAFFITI_MURAL.width ||
      y < 0 ||
      y >= GRAFFITI_MURAL.height ||
      colorIdx < 0 ||
      colorIdx >= GRAFFITI_MURAL.palette.length
    ) {
      return;
    }
    this.muralPixels[y * GRAFFITI_MURAL.width + x] = colorIdx;
    this.broadcast(MURAL_MSG.patched, { x, y, colorIdx } satisfies MuralPaintMessage);
  }

  private onMuralClear(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.muralPixels.fill(0);
    this.broadcast(MURAL_MSG.init, { pixels: this.muralPixels } satisfies MuralInitMessage);
    if (player) {
      this.broadcast(MSG.notice, { text: `🎨 ${player.name} cleared the Graffiti Pixel Mural!` });
    }
  }

  private onFootballJoinTeam(client: Client, payload: FootballTeamMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const t = payload?.team === TEAM.red ? TEAM.red : payload?.team === TEAM.blue ? TEAM.blue : TEAM.none;
    player.team = t;
    const label = t === TEAM.red ? "🔴 Red Team" : t === TEAM.blue ? "🔵 Blue Team" : "Spectators";
    client.send(MSG.notice, { text: `⚽ You joined ${label}!` } satisfies NoticeMessage);
  }

  private onFootballKick(client: Client, payload: FootballKickMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const dx = this.state.ballX - player.x;
    const dz = this.state.ballZ - player.z;
    const d = Math.hypot(dx, dz);
    if (d > 3.6) return;
    const power = clamp(typeof payload?.power === "number" ? payload.power : 16, 8, 22);
    const dirX = d > 0.2 ? dx / d : Math.sin(player.rot);
    const dirZ = d > 0.2 ? dz / d : Math.cos(player.rot);
    this.ballVx = dirX * power;
    this.ballVz = dirZ * power;
    this.lastTouchName = player.name;
  }

  private onFootballReset(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.scoreRed = 0;
    this.state.scoreBlue = 0;
    this.resetBallToCenter();
    if (player) {
      this.broadcast(MSG.notice, { text: `⚽ ${player.name} started a fresh Football Match (0 – 0)!` });
    }
  }

  private getArcadeState(): ArcadeStateBroadcast {
    return {
      c4Board: this.c4Board,
      c4Turn: this.c4Turn,
      c4Winner: this.c4Winner,
      tttBoard: this.tttBoard,
      tttTurn: this.tttTurn,
      tttWinner: this.tttWinner,
      triviaIdx: this.triviaIdx,
      triviaScores: this.triviaScores,
    };
  }

  private onArcadeMove(client: Client, payload: ArcadeMoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (payload?.game === "c4") {
      if (this.c4Winner !== 0) return;
      const col = Math.trunc(payload.colOrCell);
      if (col < 0 || col >= 7) return;
      for (let r = 5; r >= 0; r--) {
        const idx = r * 7 + col;
        if (this.c4Board[idx] === 0) {
          this.c4Board[idx] = this.c4Turn;
          if (this.checkC4Win(this.c4Turn)) {
            this.c4Winner = this.c4Turn;
            this.broadcast(MSG.notice, {
              text: `🕹️ ${player.name} won a game of Connect 4 in the East Arcade!`,
            });
          } else if (this.c4Board.every((c) => c !== 0)) {
            this.c4Winner = 3;
          } else {
            this.c4Turn = this.c4Turn === 1 ? 2 : 1;
          }
          this.broadcast(ARCADE_MSG.state, this.getArcadeState());
          return;
        }
      }
    } else if (payload?.game === "ttt") {
      if (this.tttWinner !== 0) return;
      const cell = Math.trunc(payload.colOrCell);
      if (cell < 0 || cell >= 9 || this.tttBoard[cell] !== 0) return;
      this.tttBoard[cell] = this.tttTurn;
      const lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
      ];
      const won = lines.some(
        ([a, b, c]) =>
          this.tttBoard[a!] === this.tttTurn &&
          this.tttBoard[b!] === this.tttTurn &&
          this.tttBoard[c!] === this.tttTurn,
      );
      if (won) {
        this.tttWinner = this.tttTurn;
        this.broadcast(MSG.notice, { text: `🕹️ ${player.name} won Tic-Tac-Toe in the East Arcade!` });
      } else if (this.tttBoard.every((c) => c !== 0)) {
        this.tttWinner = 3;
      } else {
        this.tttTurn = this.tttTurn === 1 ? 2 : 1;
      }
      this.broadcast(ARCADE_MSG.state, this.getArcadeState());
    } else if (payload?.game === "trivia") {
      if (payload.colOrCell === 1) {
        this.triviaScores[player.name] = (this.triviaScores[player.name] ?? 0) + 10;
        this.triviaIdx = (this.triviaIdx + 1) % 8;
        this.broadcast(ARCADE_MSG.state, this.getArcadeState());
      }
    }
  }

  private checkC4Win(who: number): boolean {
    const b = this.c4Board;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 7; c++) {
        if (c + 3 < 7 && b[r * 7 + c] === who && b[r * 7 + c + 1] === who && b[r * 7 + c + 2] === who && b[r * 7 + c + 3] === who) return true;
        if (r + 3 < 6 && b[r * 7 + c] === who && b[(r + 1) * 7 + c] === who && b[(r + 2) * 7 + c] === who && b[(r + 3) * 7 + c] === who) return true;
        if (r + 3 < 6 && c + 3 < 7 && b[r * 7 + c] === who && b[(r + 1) * 7 + c + 1] === who && b[(r + 2) * 7 + c + 2] === who && b[(r + 3) * 7 + c + 3] === who) return true;
        if (r - 3 >= 0 && c + 3 < 7 && b[r * 7 + c] === who && b[(r - 1) * 7 + c + 1] === who && b[(r - 2) * 7 + c + 2] === who && b[(r - 3) * 7 + c + 3] === who) return true;
      }
    }
    return false;
  }

  private onArcadeReset(game?: string): void {
    if (!game || game === "c4") {
      this.c4Board.fill(0);
      this.c4Turn = 1;
      this.c4Winner = 0;
    }
    if (!game || game === "ttt") {
      this.tttBoard.fill(0);
      this.tttTurn = 1;
      this.tttWinner = 0;
    }
    this.broadcast(ARCADE_MSG.state, this.getArcadeState());
  }

  // ---- South Campfire, Forest Hunting & Frieren Brick Dungeon ----------------

  private onForestEquip(client: Client, payload: ForestEquipMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const t = payload?.tool;
    player.tool = t === TOOL.torch || t === TOOL.spear || t === TOOL.bow ? t : TOOL.none;
    const names: Record<number, string> = {
      [TOOL.none]: "Empty Hands",
      [TOOL.torch]: "🔥 Night Torch",
      [TOOL.spear]: "🗡️ Hunting Spear",
      [TOOL.bow]: "🏹 Wooden Bow",
    };
    client.send(MSG.notice, { text: `Equipped: ${names[player.tool]}` } satisfies NoticeMessage);
  }

  private onForestAttack(client: Client, payload: ForestAttackMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.tool !== TOOL.spear && player.tool !== TOOL.bow) {
      client.send(MSG.notice, {
        text: "🌲 Equip a 🗡️ Spear or 🏹 Bow from the Campfire Tool Rack first to hunt!",
      } satisfies NoticeMessage);
      return;
    }

    const animal = payload?.animalId ? this.state.animals.get(payload.animalId) : undefined;
    const brain = payload?.animalId ? this.animalBrains.get(payload.animalId) : undefined;
    if (!animal || !brain || animal.hp === 0) return;

    const maxRange = player.tool === TOOL.bow ? 18 : 5.5;
    const d = Math.hypot(animal.x - player.x, animal.z - player.z);
    if (d > maxRange) {
      client.send(MSG.notice, { text: "Too far away! Get closer or use the 🏹 Bow." } satisfies NoticeMessage);
      return;
    }

    player.anim = ANIM.attack;
    animal.hp = Math.max(0, animal.hp - 1);

    if (animal.hp === 0) {
      brain.respawnAt = Date.now() + 12_000;
      const meatYield = animal.species === "boar" || animal.species === "wolf" ? 2 : 1;
      player.rawMeat = Math.min(20, player.rawMeat + meatYield);
      if (animal.species === "snake") {
        player.energy = Math.min(100, player.energy + 15);
        client.send(MSG.notice, {
          text: `🐍 Slayed forest viper! +1 Raw Meat 🥩 & +15 Venom Antidote Energy!`,
        } satisfies NoticeMessage);
      } else {
        client.send(MSG.notice, {
          text: `🏹 Hunted ${animal.species}! +${meatYield} Raw Meat 🥩 (Roast it at the Campfire!)`,
        } satisfies NoticeMessage);
      }
    } else {
      const nx = (animal.x - player.x) / Math.max(0.5, d);
      const nz = (animal.z - player.z) / Math.max(0.5, d);
      brain.vx = nx * brain.speed * 1.65;
      brain.vz = nz * brain.speed * 1.65;
      animal.rot = Math.atan2(brain.vx, brain.vz);
      brain.changeDirAt = Date.now() + 2500;
    }
  }

  private onForestForage(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.energy = Math.min(100, player.energy + 12);
    client.send(MSG.notice, { text: "🫐 Foraged wild forest berries & glowing mushrooms! +12 Energy." } satisfies NoticeMessage);
  }

  private onForestCook(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (Math.hypot(player.x - CAMPFIRE_BASE.x, player.z - CAMPFIRE_BASE.z) > 12) {
      client.send(MSG.notice, { text: "🔥 Stand near the Forest Campfire to roast meat!" } satisfies NoticeMessage);
      return;
    }
    if (player.rawMeat <= 0) {
      client.send(MSG.notice, {
        text: "🥩 You have no Raw Meat! Hunt animals or snakes in the Deep Forest first.",
      } satisfies NoticeMessage);
      return;
    }
    player.rawMeat -= 1;
    player.cookedMeat = Math.min(20, player.cookedMeat + 1);
    client.send(MSG.notice, {
      text: "🔥 Roasted 1 Raw Meat into Cooked Steak 🍖.",
    } satisfies NoticeMessage);
  }

  private onForestEat(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.cookedMeat <= 0) {
      client.send(MSG.notice, { text: "🍖 No Cooked Steak left! Roast Raw Meat at the Campfire first." } satisfies NoticeMessage);
      return;
    }
    player.cookedMeat -= 1;
    player.energy = Math.min(100, player.energy + 35);
    this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.popcorn, emoji: "🍖" } satisfies EmoteBroadcast);
    client.send(MSG.notice, {
      text: `🍖 Ate Cooked Steak! Energy is now ${player.energy}%.`,
    } satisfies NoticeMessage);
  }

  /**
   * Handles all player decisions and traps inside the Frieren-style Square Stone-Brick Dungeon:
   * - `lever1` / `lever2`: Shifts the T-Junction brick walls (West vs East Wing) & floor crack seed
   * - `chest1` / `chest2` / `chest3`: 1 Chest holds the Golden Grimoire Key (opens Secret Brick Wall);
   *   2 Chests are Mimics that chomp your head ("It's dark and scary! Pull me out!")
   * - `rescue`: Pulls a trapped friend out of a Mimic's jaws!
   * - `struggle`: Wiggles free solo after 3 presses
   * - `switchL` / `switchR`: Loose brick switches in Parallel Iron-Bar Corridors that raise the Portcullis Gates
   * - `vault`: Opens the King's Tomb Golden Vault at the end of the dungeon!
   */
  private onDungeonAction(client: Client, payload: DungeonActionMessage): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;
    if (!isInBrickDungeon(player.x, player.z)) {
      client.send(MSG.notice, { text: "🧱 Enter the Stone-Brick Dungeon across the Southern Bridge first!" } satisfies NoticeMessage);
      return;
    }

    const act = payload?.action;

    // 1. Rescue a friend stuck in a Mimic Chest!
    if (act === "rescue") {
      for (const [sid, p] of this.state.players.entries()) {
        if (sid !== client.sessionId && p.mimicTrapped > 0) {
          p.mimicTrapped = 0;
          p.z = 162;
          this.broadcast(MSG.notice, {
            text: `🤝 ${player.name} grabbed ${p.name}'s legs and pulled them out of the Mimic's jaws!`,
          } satisfies NoticeMessage);
          return;
        }
      }
      client.send(MSG.notice, { text: "Nobody is stuck inside a Mimic right now!" } satisfies NoticeMessage);
      return;
    }

    // 2. Struggle free solo when chomped by a Mimic
    if (act === "struggle") {
      if (player.mimicTrapped === 0) return;
      session.mimicStruggles += 1;
      if (session.mimicStruggles >= 3) {
        player.mimicTrapped = 0;
        session.mimicStruggles = 0;
        player.z = 162;
        this.broadcast(MSG.notice, {
          text: `💨 ${player.name} wiggled free from the Mimic with messy hair!`,
        } satisfies NoticeMessage);
      } else {
        client.send(MSG.notice, {
          text: `🦷 "It's dark and scary!" (${3 - session.mimicStruggles} more struggles or have a friend press E to pull you out!)`,
        } satisfies NoticeMessage);
      }
      return;
    }

    if (player.mimicTrapped > 0) {
      client.send(MSG.notice, {
        text: "🦷 Your head is stuck inside a Mimic! Click '🦵 Struggle Free' or ask a friend to pull you out!",
      } satisfies NoticeMessage);
      return;
    }

    // 3. Decision 1: Shifting Brick T-Junction Levers (lever1 = West Wing, lever2 = East Wing)
    if (act === "lever1" || act === "lever2") {
      const wing = act === "lever1" ? 1 : 2;
      this.state.dungeonWing = wing;
      this.state.dungeonSeed = (this.state.dungeonSeed + 1) % 3;
      const wingName = wing === 1 ? "🌙 West Brick Wing" : "☀️ East Brick Wing";
      this.broadcast(MSG.notice, {
        text: `⚙️ ${player.name} pulled the Iron Lever — heavy stone bricks ground open to the ${wingName} and reshuffled the dungeon traps!`,
      } satisfies NoticeMessage);
      return;
    }

    // 4. Decision 2: Frieren's 3-Chest Mimic Gamble (chest1, chest2, chest3)
    if (act === "chest1" || act === "chest2" || act === "chest3") {
      const chestNum = act === "chest1" ? 1 : act === "chest2" ? 2 : 3;
      const realChest = (this.state.dungeonSeed % 3) + 1;
      const chestXs: Record<number, number> = { 1: -5.2, 2: 0, 3: 5.2 };

      if (chestNum === realChest) {
        this.state.grimoireFound = 1;
        player.energy = Math.min(100, player.energy + 45);
        this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.cheer, emoji: "📖" } satisfies EmoteBroadcast);
        this.broadcast(MSG.notice, {
          text: `📖✨ 1% Legendary Grimoire! ${player.name} opened Chest #${chestNum} and found the Ancient Grimoire Key — the Secret Brick Bookcase Wall slid open!`,
        } satisfies NoticeMessage);
      } else {
        player.mimicTrapped = chestNum;
        session.mimicStruggles = 0;
        player.x = chestXs[chestNum] ?? 0;
        player.z = 165.2;
        player.rot = 0;
        player.energy = Math.max(15, player.energy - 15);
        this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.mindblown, emoji: "🦷" } satisfies EmoteBroadcast);
        this.broadcast(MSG.notice, {
          text: `📦🦷 CHOMP! Chest #${chestNum} is a MIMIC! ${player.name} is stuck head-first inside ("It's dark and scary! Pull me out!")!`,
        } satisfies NoticeMessage);
      }
      return;
    }

    // 5. Decision 3: Parallel Iron-Bar Corridor Loose Brick Switches (switchL, switchR)
    if (act === "switchL" || act === "switchR") {
      if (act === "switchL") {
        this.state.gateRightOpen = 1;
        this.state.gateLeftOpen = 1;
      } else {
        this.state.gateLeftOpen = 1;
        this.state.gateRightOpen = 1;
      }
      this.broadcast(MSG.notice, {
        text: `🧱⛓️ ${player.name} pressed the hidden loose brick in the wall — the Iron Portcullis Gates ground upward!`,
      } satisfies NoticeMessage);
      return;
    }

    // 6. Sanctum 4: The King's Tomb Golden Vault
    if (act === "vault") {
      this.state.vaultUnlocked = 1;
      for (const [sid, p] of this.state.players.entries()) {
        if (isInBrickDungeon(p.x, p.z)) {
          p.energy = 100;
          p.cookedMeat = Math.min(20, p.cookedMeat + 3);
          p.mimicTrapped = 0;
          this.broadcast(MSG.emote, { id: sid, anim: ANIM.mindblown, emoji: "👑" } satisfies EmoteBroadcast);
        }
      }
      this.broadcast(MSG.notice, {
        text: `👑📖 ${player.name} conquered the Ruins of the King's Tomb! Everyone in the dungeon received 100% Energy, +3 Steaks 🍖 & First-Class Mage honors!`,
      } satisfies NoticeMessage);

      if (this.dungeonResetTimer) clearTimeout(this.dungeonResetTimer);
      this.dungeonResetTimer = setTimeout(() => {
        this.state.dungeonSeed = (this.state.dungeonSeed + 1) % 3;
        this.state.dungeonWing = this.state.dungeonWing === 1 ? 2 : 1;
        this.state.grimoireFound = 0;
        this.state.gateLeftOpen = 0;
        this.state.gateRightOpen = 0;
        this.state.vaultUnlocked = 0;
      }, 20_000);
    }
  }

  // ---- Cinema Host & Simple Link Player -------------------------------------

  private evaluateCinemaHost(announce = false): void {
    const currentId = this.state.cinemaHostId;
    const currentPlayer = currentId ? this.state.players.get(currentId) : undefined;

    const inHall: Array<{ sid: string; name: string; enteredAt: number }> = [];
    for (const [sid, p] of this.state.players.entries()) {
      const sess = this.sessions.get(sid);
      if (!sess) continue;
      const inside = (p.seatId >= 0 && p.seatId < 24) || isInCinemaHall(p.x, p.z);
      if (inside) {
        if (sess.enteredCinemaAt === 0) sess.enteredCinemaAt = Date.now();
        inHall.push({ sid, name: p.name, enteredAt: sess.enteredCinemaAt });
      } else {
        sess.enteredCinemaAt = 0;
      }
    }

    if (currentPlayer && inHall.some((h) => h.sid === currentId)) {
      this.state.cinemaHostName = currentPlayer.name;
      return;
    }

    if (inHall.length > 0) {
      inHall.sort((a, b) => a.enteredAt - b.enteredAt);
      const winner = inHall[0]!;
      const changed = this.state.cinemaHostId !== winner.sid;
      this.state.cinemaHostId = winner.sid;
      this.state.cinemaHostName = winner.name;
      if (changed && announce) {
        this.broadcast(MSG.notice, {
          text: `👑 ${winner.name} is now the Cinema Host.`,
        } satisfies NoticeMessage);
      }
      return;
    }

    if (currentPlayer) {
      this.state.cinemaHostName = currentPlayer.name;
      return;
    }

    let earliestSid = "";
    let earliestName = "";
    let earliestJoin = Infinity;
    for (const [sid, p] of this.state.players.entries()) {
      const sess = this.sessions.get(sid);
      if (sess && sess.joinedAt < earliestJoin) {
        earliestJoin = sess.joinedAt;
        earliestSid = sid;
        earliestName = p.name;
      }
    }
    this.state.cinemaHostId = earliestSid;
    this.state.cinemaHostName = earliestName;
  }

  private ensureIsCinemaHost(client: Client): boolean {
    this.evaluateCinemaHost();
    if (this.state.cinemaHostId === client.sessionId) return true;
    const hostName = this.state.cinemaHostName || "the Cinema Host";
    client.send(MSG.notice, {
      text: `🔒 Only 👑 ${hostName} (1st in the Cinema Hall) can control the movie.`,
    } satisfies NoticeMessage);
    return false;
  }

  private onCinemaTransferHost(client: Client, payload: CinemaTransferHostMessage): void {
    if (!this.ensureIsCinemaHost(client)) return;
    const targetSid = payload?.targetSessionId;
    const targetPlayer = targetSid ? this.state.players.get(targetSid) : undefined;
    const targetSession = targetSid ? this.sessions.get(targetSid) : undefined;
    if (!targetPlayer || !targetSession || !targetSid) return;

    targetSession.enteredCinemaAt = 1;
    this.state.cinemaHostId = targetSid;
    this.state.cinemaHostName = targetPlayer.name;
    this.broadcast(MSG.notice, {
      text: `👑 Cinema Host passed to ${targetPlayer.name}!`,
    } satisfies NoticeMessage);
  }

  private onCinemaSetUrl(client: Client, payload: CinemaSetUrlMessage): void {
    if (!this.ensureIsCinemaHost(client)) return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const rawUrl = typeof payload?.url === "string" ? payload.url.trim().slice(0, 500) : "";
    if (!rawUrl) {
      this.state.movieUrl = "";
      this.state.movieDurationSec = 0;
      this.state.movieStartedAt = 0;
      this.state.moviePaused = 0;
      this.state.moviePausedAtSec = 0;
      return;
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      client.send(MSG.notice, { text: "Please paste a valid http:// or https:// video link." } satisfies NoticeMessage);
      return;
    }

    this.state.movieUrl = rawUrl;
    this.state.movieDurationSec = 0;
    this.state.movieStartedAt = Date.now();
    this.state.moviePaused = 0;
    this.state.moviePausedAtSec = 0;
    this.broadcast(MSG.notice, {
      text: `🎬 Host 👑 ${player.name} started a video in the Cinema Hall!`,
    } satisfies NoticeMessage);
  }

  private onCinemaSetDuration(client: Client, payload: CinemaSetDurationMessage): void {
    const dur = typeof payload?.durationSec === "number" && isFinite(payload.durationSec) ? payload.durationSec : 0;
    if (dur <= 1 || dur > 86_400) return;
    if (this.state.cinemaHostId === client.sessionId || this.state.movieDurationSec <= 0) {
      this.state.movieDurationSec = Math.round(dur);
    }
  }

  private onCinemaControl(client: Client, payload: CinemaControlMessage): void {
    if (!this.ensureIsCinemaHost(client)) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || !this.state.movieUrl) return;
    const action = payload?.action;
    if (action === "restart") {
      this.state.movieStartedAt = Date.now();
      this.state.moviePaused = 0;
      this.state.moviePausedAtSec = 0;
      this.broadcast(CINEMA_MSG.syncSeek, {
        seekSec: 0,
        paused: false,
        byName: player.name,
      } satisfies CinemaSyncSeekBroadcast);
    } else if (action === "toggle") {
      if (this.state.moviePaused === 1) {
        const resumeSec = this.state.moviePausedAtSec;
        this.state.movieStartedAt = Date.now() - resumeSec * 1000;
        this.state.moviePaused = 0;
        this.broadcast(CINEMA_MSG.syncSeek, {
          seekSec: resumeSec,
          paused: false,
          byName: player.name,
        } satisfies CinemaSyncSeekBroadcast);
      } else {
        const elapsedSec = Math.max(0, (Date.now() - this.state.movieStartedAt) / 1000);
        this.state.moviePausedAtSec = elapsedSec;
        this.state.moviePaused = 1;
        this.broadcast(CINEMA_MSG.syncSeek, {
          seekSec: elapsedSec,
          paused: true,
          byName: player.name,
        } satisfies CinemaSyncSeekBroadcast);
      }
    } else if (action === "seek" && typeof payload?.seekSec === "number" && isFinite(payload.seekSec)) {
      const maxDur = this.state.movieDurationSec > 0 ? this.state.movieDurationSec : 86_400;
      const sec = clamp(payload.seekSec, 0, maxDur);
      this.state.movieStartedAt = Date.now() - sec * 1000;
      this.state.moviePausedAtSec = sec;
      this.broadcast(CINEMA_MSG.syncSeek, {
        seekSec: sec,
        paused: this.state.moviePaused === 1,
        byName: player.name,
      } satisfies CinemaSyncSeekBroadcast);
    }
  }

  private onMove(client: Client, payload: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;
    if (player.mimicTrapped > 0) return;
    if (!isFinite(payload?.x) || !isFinite(payload?.z) || !isFinite(payload?.rot)) return;

    const now = Date.now();
    const dt = Math.max((now - session.lastMoveAt) / 1000, 1 / 60);
    session.lastMoveAt = now;

    if (player.seatId >= 0 && payload.anim === ANIM.sit) {
      const seat = CINEMA_SEATS[player.seatId];
      if (seat) {
        player.x = seat.x;
        player.z = seat.z;
        player.rot = payload.rot;
        player.anim = ANIM.sit;
        return;
      }
    }

    let x = clamp(payload.x, -WORLD.half, WORLD.half);
    let z = clamp(payload.z, -WORLD.half, WORLD.half);

    const dx = x - player.x;
    const dz = z - player.z;
    const dist = Math.hypot(dx, dz);
    const allowed = PLAYER.maxSpeed * SPEED_SLACK * dt;
    if (dist > allowed && dist > 0 && player.seatId < 0) {
      const k = allowed / dist;
      x = player.x + dx * k;
      z = player.z + dz * k;
    }

    const wasInCinema = (player.seatId >= 0 && player.seatId < 24) || isInCinemaHall(player.x, player.z);
    if (player.seatId >= 0 && (payload.anim === ANIM.walk || payload.anim === ANIM.run)) {
      player.seatId = -1;
    }

    player.x = x;
    player.z = z;
    player.rot = payload.rot;
    const validAnims: readonly number[] = [
      ANIM.idle,
      ANIM.walk,
      ANIM.run,
      ANIM.sit,
      ANIM.wave,
      ANIM.cheer,
      ANIM.popcorn,
      ANIM.mindblown,
      ANIM.attack,
    ];
    player.anim = validAnims.includes(payload.anim) ? payload.anim : ANIM.idle;

    const nowInCinema = (player.seatId >= 0 && player.seatId < 24) || isInCinemaHall(player.x, player.z);
    if (wasInCinema !== nowInCinema) {
      this.evaluateCinemaHost(true);
    }
  }

  private onSeat(client: Client, payload: SeatMessage): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session || player.mimicTrapped > 0) return;

    const requested = typeof payload?.seatId === "number" ? Math.trunc(payload.seatId) : -1;
    if (requested < 0 || requested >= CINEMA_SEATS.length) {
      player.seatId = -1;
      player.anim = ANIM.idle;
      this.evaluateCinemaHost(false);
      return;
    }

    const occupied = new Set<number>();
    for (const [sid, p] of this.state.players.entries()) {
      if (sid !== client.sessionId && p.seatId >= 0) occupied.add(p.seatId);
    }

    let targetSeat = CINEMA_SEATS[requested]!;
    if (occupied.has(targetSeat.id)) {
      const sameZoneSeats = CINEMA_SEATS.filter((s) => s.row === targetSeat.row && !occupied.has(s.id));
      const pool = sameZoneSeats.length > 0 ? sameZoneSeats : CINEMA_SEATS.filter((s) => !occupied.has(s.id));
      const alt = pool.sort(
        (a, b) => Math.hypot(a.x - targetSeat.x, a.z - targetSeat.z) - Math.hypot(b.x - targetSeat.x, b.z - targetSeat.z),
      )[0];
      if (!alt) {
        client.send(MSG.notice, { text: "All seats here are currently taken!" } satisfies NoticeMessage);
        return;
      }
      targetSeat = alt;
    }

    player.seatId = targetSeat.id;
    player.x = targetSeat.x;
    player.z = targetSeat.z;
    player.rot = targetSeat.rot;
    player.anim = ANIM.sit;
    session.lastMoveAt = Date.now();
    this.evaluateCinemaHost(true);
  }

  private onEmote(client: Client, payload: EmoteMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const anim = payload?.anim ?? ANIM.wave;
    const emoji = typeof payload?.emoji === "string" ? payload.emoji.slice(0, 8) : "👋";
    if (player.seatId < 0) {
      player.anim = anim;
    }
    const msg: EmoteBroadcast = { id: client.sessionId, anim, emoji };
    this.broadcast(MSG.emote, msg);
  }

  private onFriendRequest(client: Client, payload: FriendRequestSend): void {
    const sender = this.state.players.get(client.sessionId);
    const senderSession = this.sessions.get(client.sessionId);
    if (!sender || !senderSession) return;

    const targetSessionId = payload?.toSessionId;
    if (!targetSessionId || targetSessionId === client.sessionId) return;

    const targetPlayer = this.state.players.get(targetSessionId);
    const targetSession = this.sessions.get(targetSessionId);
    const targetClient = this.clients.find((c) => c.sessionId === targetSessionId);
    if (!targetPlayer || !targetSession || !targetClient) {
      client.send(MSG.notice, { text: "That player is no longer in the room." } satisfies NoticeMessage);
      return;
    }

    const myFriends = getFriendsSet(senderSession.clientId);
    if (myFriends.has(targetSession.clientId)) {
      client.send(MSG.notice, { text: `You and ${targetPlayer.name} are already friends!` } satisfies NoticeMessage);
      return;
    }

    const incoming: FriendIncomingMessage = {
      fromSessionId: client.sessionId,
      fromClientId: senderSession.clientId,
      fromName: sender.name,
      fromColor: sender.color,
    };
    targetClient.send(FRIEND_MSG.incoming, incoming);
    client.send(MSG.notice, { text: `Friend request sent to ${targetPlayer.name}.` } satisfies NoticeMessage);
  }

  private onFriendAccept(client: Client, payload: FriendAcceptSend): void {
    const accepter = this.state.players.get(client.sessionId);
    const accepterSession = this.sessions.get(client.sessionId);
    if (!accepter || !accepterSession) return;

    const fromClientId = payload?.fromClientId;
    if (typeof fromClientId !== "string" || !fromClientId) return;

    getFriendsSet(accepterSession.clientId).add(fromClientId);
    getFriendsSet(fromClientId).add(accepterSession.clientId);

    this.syncFriendsToClient(client, accepterSession.clientId);

    for (const [sid, sess] of this.sessions.entries()) {
      if (sess.clientId === fromClientId) {
        const otherClient = this.clients.find((c) => c.sessionId === sid);
        const otherPlayer = this.state.players.get(sid);
        if (otherClient) {
          this.syncFriendsToClient(otherClient, fromClientId);
          otherClient.send(MSG.notice, {
            text: `${accepter.name} accepted your friend request! You can now hear each other anywhere.`,
          } satisfies NoticeMessage);
        }
        if (otherPlayer) {
          client.send(MSG.notice, {
            text: `You and ${otherPlayer.name} are now friends! Voice connected anywhere.`,
          } satisfies NoticeMessage);
        }
      }
    }
  }

  private onFriendRemove(client: Client, payload: FriendRemoveSend): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const friendClientId = payload?.friendClientId;
    if (typeof friendClientId !== "string" || !friendClientId) return;

    getFriendsSet(session.clientId).delete(friendClientId);
    getFriendsSet(friendClientId).delete(session.clientId);

    this.syncFriendsToClient(client, session.clientId);
    for (const [sid, sess] of this.sessions.entries()) {
      if (sess.clientId === friendClientId) {
        const otherClient = this.clients.find((c) => c.sessionId === sid);
        if (otherClient) this.syncFriendsToClient(otherClient, friendClientId);
      }
    }
  }

  private syncFriendsToClient(client: Client, clientId: string): void {
    const friendClientIds = [...getFriendsSet(clientId)];
    client.send(FRIEND_MSG.synced, { friendClientIds } satisfies FriendSyncedMessage);
  }

  private onChat(client: Client, payload: ChatSend): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;

    const text = sanitizeChat(payload?.text);
    if (text.length === 0) return;

    const now = Date.now();
    if (now - session.lastChatAt < 500) {
      client.send(MSG.notice, { text: "Slow down a little." } satisfies NoticeMessage);
      return;
    }
    session.lastChatAt = now;

    const message: ChatBroadcast = { id: client.sessionId, name: player.name, text, at: now };
    this.broadcast(MSG.chat, message);
  }

  private ideaAction(client: Client, ctx: MessageContext, action: (who: { id: string; name: string }) => Idea) {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return ctx.reject("not-in-room");
    try {
      const idea = action({ id: session.clientId, name: player.name });
      this.broadcast(IDEA_MSG.changed, idea);
      return idea;
    } catch (err) {
      if (err instanceof IdeaRejected) return ctx.reject(err.code);
      throw err;
    }
  }
}
