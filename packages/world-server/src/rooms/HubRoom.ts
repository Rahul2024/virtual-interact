import { Room, definePlugins, type Client } from "colyseus";
import { WebRTCPlugin } from "colyseus/plugins/webrtc";
import type { MessageContext } from "@colyseus/shared-types";
import {
  ANCIENT_RUINS,
  ANIM,
  ARCADE_MSG,
  CAMPFIRE_BASE,
  CAVE_DUNGEON,
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
  isInAncientRuins,
  isInCaveDungeon,
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
  type DungeonDecisionMessage,
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
  lastRuinsBlessingAt: number;
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
  private vaultCloseTimer: ReturnType<typeof setTimeout> | undefined;

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

    // South Campfire, Deep Forest Survival, Ancient Ruins & Shifting Dungeon
    [FOREST_MSG.equipTool]: (client: Client, payload: ForestEquipMessage) => this.onForestEquip(client, payload),
    [FOREST_MSG.attackAnimal]: (client: Client, payload: ForestAttackMessage) => this.onForestAttack(client, payload),
    [FOREST_MSG.forageBerry]: (client: Client) => this.onForestForage(client),
    [FOREST_MSG.cookMeat]: (client: Client) => this.onForestCook(client),
    [FOREST_MSG.eatMeat]: (client: Client) => this.onForestEat(client),
    [FOREST_MSG.ruinsBlessing]: (client: Client) => this.onRuinsBlessing(client),
    [FOREST_MSG.dungeonDecision]: (client: Client, payload: DungeonDecisionMessage) =>
      this.onDungeonDecision(client, payload),

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
    this.state.dungeonVariant = 0;
    this.state.dungeonChoice1 = 1;
    this.state.dungeonChoice2 = 1;
    this.state.dungeonGateOpen = 0;
    this.state.boulderZ = CAVE_DUNGEON.gauntletEndZ;
    this.state.boulderLaneX = CAVE_DUNGEON.centerX;

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
      { id: "rabbit-1", species: "rabbit", xMin: -55, xMax: 35, zMin: 76, zMax: 105, hp: 1, speed: 3.4 },
      { id: "rabbit-2", species: "rabbit", xMin: -40, xMax: 45, zMin: 80, zMax: 110, hp: 1, speed: 3.4 },
      { id: "deer-1", species: "deer", xMin: -65, xMax: 25, zMin: 86, zMax: 125, hp: 2, speed: 3.0 },
      { id: "deer-2", species: "deer", xMin: -30, xMax: 50, zMin: 90, zMax: 132, hp: 2, speed: 3.0 },
      { id: "boar-1", species: "boar", xMin: -70, xMax: 20, zMin: 98, zMax: 145, hp: 3, speed: 2.6 },
      { id: "boar-2", species: "boar", xMin: -25, xMax: 35, zMin: 105, zMax: 150, hp: 3, speed: 2.6 },
      { id: "wolf-1", species: "wolf", xMin: -75, xMax: 15, zMin: 128, zMax: 175, hp: 4, speed: 3.6 },
      { id: "wolf-2", species: "wolf", xMin: -35, xMax: 30, zMin: 135, zMax: 185, hp: 4, speed: 3.6 },
      // Slithering Forest Snakes & Temple Vipers
      { id: "snake-1", species: "snake", xMin: -62, xMax: -28, zMin: 118, zMax: 156, hp: 2, speed: 3.3 },
      { id: "snake-2", species: "snake", xMin: -58, xMax: -32, zMin: 125, zMax: 158, hp: 2, speed: 3.5 },
      { id: "snake-3", species: "snake", xMin: -25, xMax: 25, zMin: 84, zMax: 128, hp: 1, speed: 3.2 },
      { id: "snake-4", species: "snake", xMin: 15, xMax: 42, zMin: 96, zMax: 136, hp: 2, speed: 3.4 },
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
    this.tickDungeon(dt);
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

      // Snakes actively slither toward nearby players and bite if they get too close!
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
   * Server-side simulation of the Shifting Cave Dungeon booby traps:
   * - Rolling Boulder Chute (`boulderZ`, `boulderLaneX`)
   * - Swinging Pendulum Axes (`z = 167, 173, 179`)
   * - Shifting Labyrinth Pressure Plates & Sliding Stone Doors (`z = 138..158`)
   */
  private tickDungeon(dt: number) {
    const cx = CAVE_DUNGEON.centerX;
    const boulderSpeed = this.state.dungeonChoice2 === 2 ? 12.5 : 8.5;
    let bz = this.state.boulderZ - boulderSpeed * dt;
    if (bz < CAVE_DUNGEON.gauntletStartZ - 1.5) {
      bz = CAVE_DUNGEON.gauntletEndZ;
      // Shift boulder lane based on active dungeon choices and variant
      const lanes =
        this.state.dungeonChoice2 === 2
          ? [cx - 2.8, cx, cx + 2.8]
          : [cx, cx - 2.6, cx + 2.6];
      const nextIdx = (Math.floor(Date.now() / 1800) + this.state.dungeonVariant) % lanes.length;
      this.state.boulderLaneX = lanes[nextIdx]!;
    }
    this.state.boulderZ = bz;

    const now = Date.now();
    const tSec = now / 1000;
    const pendulumSpeed = this.state.dungeonChoice2 === 1 ? 2.6 : 1.85;

    for (const [sid, p] of this.state.players.entries()) {
      if (!isInCaveDungeon(p.x, p.z)) continue;
      const sess = this.sessions.get(sid);
      if (!sess || now - sess.lastTrapHitAt < 1800) continue;

      // 1. Chamber 2: Sliding Stone Door & Pressure Plate Poison Dart Traps (z = 138..158)
      if (p.z >= CAVE_DUNGEON.labyrinthStartZ && p.z <= CAVE_DUNGEON.labyrinthEndZ) {
        const inLeftCorridor = p.x < cx;
        const leftOpen = this.state.dungeonChoice1 === 1;
        // If player tries to walk into the sealed side of the shifting labyrinth, push them back to Decision 1
        if ((inLeftCorridor && !leftOpen) || (!inLeftCorridor && leftOpen)) {
          p.z = CAVE_DUNGEON.labyrinthStartZ - 1.5;
          sess.lastTrapHitAt = now;
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: `🚪 This labyrinth passage is sealed! Use the ${leftOpen ? "Left (🔥 Blades)" : "Right (🐍 Shadows)"} corridor or flip the Chamber 1 Pedestal!`,
          } satisfies NoticeMessage);
          continue;
        }

        // Check 3 rows of Pressure Plates at z = 142, 148, 154
        const corridorCenterX = inLeftCorridor ? cx - 3.6 : cx + 3.6;
        const plateRows = [142, 148, 154];
        for (let r = 0; r < plateRows.length; r++) {
          const pz = plateRows[r]!;
          if (Math.abs(p.z - pz) < 1.15) {
            // Which side of the sub-corridor has the rigged red pressure plate shifts with dungeonVariant!
            const trapOnInnerSide = (r + this.state.dungeonVariant) % 2 === 0;
            const trapX = trapOnInnerSide ? corridorCenterX + 1.15 : corridorCenterX - 1.15;
            if (Math.abs(p.x - trapX) < 1.1) {
              sess.lastTrapHitAt = now;
              p.z = CAVE_DUNGEON.labyrinthStartZ - 2.0;
              p.energy = Math.max(10, p.energy - 18);
              const cl = this.clients.find((c) => c.sessionId === sid);
              cl?.send(MSG.notice, {
                text: "🎯 Poison Dart Trap! You stepped on a red pressure plate and got knocked back! (-18 Energy — hug the mossy green tiles!)",
              } satisfies NoticeMessage);
              break;
            }
          }
        }
      }

      // 2. Chamber 3: Swinging Pendulum Axes (z = 167, 173, 179) & Rolling Boulder
      if (p.z >= CAVE_DUNGEON.gauntletStartZ - 1 && p.z <= CAVE_DUNGEON.gauntletEndZ + 1) {
        const bladeZs = [167, 173, 179];
        let hitBlade = false;
        for (let i = 0; i < bladeZs.length; i++) {
          const bzBlade = bladeZs[i]!;
          if (Math.abs(p.z - bzBlade) < 1.05) {
            const swingAngle = Math.sin(tSec * pendulumSpeed + i * 2.1) * 0.95;
            const bladeX = cx + Math.sin(swingAngle) * 5.2;
            if (Math.abs(p.x - bladeX) < 1.65) {
              hitBlade = true;
              break;
            }
          }
        }
        if (hitBlade) {
          sess.lastTrapHitAt = now;
          p.z = CAVE_DUNGEON.decision2Z - 1.0;
          p.energy = Math.max(10, p.energy - 20);
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "🪓 Sliced by a Swinging Pendulum Axe! Knocked back to the Crossroads (-20 Energy).",
          } satisfies NoticeMessage);
          continue;
        }

        // Rolling Boulder collision check (alcoves at |x - cx| > 5.2 are always safe!)
        const inSafeAlcove = Math.abs(p.x - cx) > 5.0;
        if (!inSafeAlcove && Math.hypot(p.x - this.state.boulderLaneX, p.z - this.state.boulderZ) < 2.05) {
          sess.lastTrapHitAt = now;
          p.z = CAVE_DUNGEON.decision2Z - 1.5;
          p.energy = Math.max(10, p.energy - 25);
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "🪨 Flattened by the Rolling Boulder! Duck into the side wall alcoves as it rumbles past (-25 Energy).",
          } satisfies NoticeMessage);
          continue;
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

    const now = Date.now();
    this.state.players.set(client.sessionId, player);
    this.sessions.set(client.sessionId, {
      lastMoveAt: now,
      lastChatAt: 0,
      lastTrapHitAt: 0,
      lastSnakeBiteAt: 0,
      lastRuinsBlessingAt: 0,
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
    if (this.vaultCloseTimer) clearTimeout(this.vaultCloseTimer);
    console.log(`[hub] room ${this.roomId} disposed`);
  }

  // ---- Pixel Graffiti Mural -------------------------------------------------

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

  // ---- West Football Stadium ------------------------------------------------

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

  // ---- East Multiplayer Arcade ----------------------------------------------

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

  // ---- South Campfire, Forest Hunting, Ancient Ruins & Shifting Dungeon -----

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

  private onRuinsBlessing(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;
    if (!isInAncientRuins(player.x, player.z)) {
      client.send(MSG.notice, { text: "🏛️ Walk into the South-West Ancient Temple Ruins first!" } satisfies NoticeMessage);
      return;
    }
    const now = Date.now();
    if (now - session.lastRuinsBlessingAt < 10_000) {
      client.send(MSG.notice, { text: "🏛️ The Ancient Sun Altar is recharging its solar runes…" } satisfies NoticeMessage);
      return;
    }
    session.lastRuinsBlessingAt = now;
    player.energy = Math.min(100, player.energy + 30);
    this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.cheer, emoji: "🏛️" } satisfies EmoteBroadcast);
    const runeHint =
      this.state.dungeonVariant % 3 === 0
        ? "🩸 Crimson Idol"
        : this.state.dungeonVariant % 3 === 1
          ? "🌿 Emerald Idol"
          : "☀️ Golden Idol";
    client.send(MSG.notice, {
      text: `🏛️ Ancient Sun Blessing (+30 Energy)! Temple inscription whispers: "Seek the ${runeHint} in the Mountain Cave Sanctum…"`,
    } satisfies NoticeMessage);
  }

  /**
   * Handles player decisions inside the 90m Shifting Cave Dungeon:
   * - Stage 1 (Chamber 1 Pedestals): Chooses Left (🔥 Trial of Blades) vs Right (🐍 Trial of Shadows),
   *   sliding the labyrinth stone doors and shifting the pressure plate pattern!
   * - Stage 2 (Chamber 3 Crossroads Totem): Switches between ⚡ Rapid Pendulum Mode and 🪨 Boulder Surge Mode!
   * - Stage 3 (Chamber 4 Sanctum Idols): Picking the True Idol unlocks the Treasure Vault; picking a Trap Idol
   *   reshuffles the entire dungeon layout and teleports you back to the Crossroads!
   */
  private onDungeonDecision(client: Client, payload: DungeonDecisionMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!isInCaveDungeon(player.x, player.z)) {
      client.send(MSG.notice, { text: "🦇 Enter the Eastern Mountain Cave Dungeon first!" } satisfies NoticeMessage);
      return;
    }

    const stage = payload?.stage;
    const choice = payload?.choice;

    if (stage === 1 && (choice === 1 || choice === 2)) {
      this.state.dungeonChoice1 = choice;
      this.state.dungeonVariant = (this.state.dungeonVariant + 1) % 3;
      const label = choice === 1 ? "🔥 Trial of Blades (Left Labyrinth Open)" : "🐍 Trial of Shadows (Right Labyrinth Open)";
      this.broadcast(MSG.notice, {
        text: `🗝️ ${player.name} activated ${label} — the cave walls and pressure plates shifted!`,
      } satisfies NoticeMessage);
      return;
    }

    if (stage === 2 && (choice === 1 || choice === 2)) {
      this.state.dungeonChoice2 = choice;
      const label = choice === 1 ? "⚡ Twin Pendulum Rhythm" : "🪨 Heavy Rolling Boulder Surge";
      this.broadcast(MSG.notice, {
        text: `⚙️ ${player.name} turned the Crossroads Totem to ${label}!`,
      } satisfies NoticeMessage);
      return;
    }

    if (stage === 3 && (choice === 1 || choice === 2 || choice === 3)) {
      const trueChoice = (this.state.dungeonVariant % 3) + 1;
      const idolNames: Record<number, string> = {
        1: "🩸 Crimson Idol",
        2: "🌿 Emerald Idol",
        3: "☀️ Golden Idol",
      };

      if (choice === trueChoice) {
        this.state.dungeonGateOpen = 1;
        // Reward everyone currently inside the cave dungeon!
        for (const [sid, p] of this.state.players.entries()) {
          if (isInCaveDungeon(p.x, p.z)) {
            p.energy = 100;
            p.cookedMeat = Math.min(20, p.cookedMeat + 3);
            this.broadcast(MSG.emote, { id: sid, anim: ANIM.mindblown, emoji: "👑" } satisfies EmoteBroadcast);
          }
        }
        this.broadcast(MSG.notice, {
          text: `👑 ${player.name} chose the true ${idolNames[choice]} and unlocked the Ancient Cave Treasure Vault! Everyone in the cave received 100% Energy & +3 Steaks 🍖!`,
        } satisfies NoticeMessage);

        if (this.vaultCloseTimer) clearTimeout(this.vaultCloseTimer);
        this.vaultCloseTimer = setTimeout(() => {
          this.state.dungeonGateOpen = 0;
          this.state.dungeonVariant = (this.state.dungeonVariant + 1) % 3;
          this.state.dungeonChoice1 = this.state.dungeonChoice1 === 1 ? 2 : 1;
        }, 18_000);
      } else {
        // Mimic / Trap Idol: reshuffle the entire dungeon layout and send player back to the Crossroads!
        this.state.dungeonGateOpen = 0;
        this.state.dungeonVariant = (this.state.dungeonVariant + 1) % 3;
        this.state.dungeonChoice1 = this.state.dungeonChoice1 === 1 ? 2 : 1;
        this.state.dungeonChoice2 = this.state.dungeonChoice2 === 1 ? 2 : 1;
        player.z = CAVE_DUNGEON.decision2Z - 1.5;
        player.energy = Math.max(15, player.energy - 20);
        this.broadcast(MSG.notice, {
          text: `💀 Trap Idol! ${player.name} touched the false ${idolNames[choice]} — the entire dungeon shifted into Layout #${this.state.dungeonVariant + 1}!`,
        } satisfies NoticeMessage);
      }
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
    if (!player || !session) return;

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
