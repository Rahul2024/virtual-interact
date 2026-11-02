import { Room, definePlugins, type Client } from "colyseus";
import { WebRTCPlugin } from "colyseus/plugins/webrtc";
import type { MessageContext } from "@colyseus/shared-types";
import {
  ANIM,
  ARCADE_MSG,
  BRICK_DUNGEON,
  dungeonClosedDoors,
  type WallBox,
  CAMPFIRE_BASE,
  CINEMA_HALL,
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
  /** Last position that passed the dungeon wall check; where we put you back if you cross a door. */
  lastSafeX: number;
  lastSafeZ: number;
  lastDoorNoticeAt: number;
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
    this.state.websBurned = 0;
    this.state.gateLeftOpen = 0;
    this.state.gateRightOpen = 0;
    this.state.vaultUnlocked = 0;
    this.state.arrowVolleyZ = BRICK_DUNGEON.hall1EndZ;
    this.state.fireBoulderZ = BRICK_DUNGEON.boulderEndZ;

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
      { id: "wolf-1", species: "wolf", xMin: -85, xMax: -26, zMin: 128, zMax: 185, hp: 4, speed: 3.6 },
      { id: "wolf-2", species: "wolf", xMin: 26, xMax: 85, zMin: 135, zMax: 190, hp: 4, speed: 3.6 },
      // Slithering Forest Snakes & Vipers
      { id: "snake-1", species: "snake", xMin: -65, xMax: -24, zMin: 85, zMax: 150, hp: 2, speed: 3.3 },
      { id: "snake-2", species: "snake", xMin: 24, xMax: 65, zMin: 85, zMax: 150, hp: 2, speed: 3.5 },
      { id: "snake-3", species: "snake", xMin: -55, xMax: -24, zMin: 118, zMax: 175, hp: 1, speed: 3.2 },
      { id: "snake-4", species: "snake", xMin: 24, xMax: 55, zMin: 118, zMax: 175, hp: 2, speed: 3.4 },
      // Floor 2 (Fire Hallway): 4 Giant Ember Spiders hanging & patrolling near the cobweb nets
      { id: "spider-1", species: "spider", xMin: -15, xMax: -2, zMin: 232, zMax: 265, hp: 2, speed: 3.3 },
      { id: "spider-2", species: "spider", xMin: 2, xMax: 15, zMin: 235, zMax: 270, hp: 2, speed: 3.4 },
      { id: "spider-3", species: "spider", xMin: -15, xMax: 0, zMin: 268, zMax: 306, hp: 2, speed: 3.3 },
      { id: "spider-4", species: "spider", xMin: 0, xMax: 15, zMin: 270, zMax: 308, hp: 2, speed: 3.5 },
      // Floor 3 (Shadow Hallway & Grand Stairs): 4 Small Shadow Wolves guarding the approach to the Boss!
      { id: "shadow-wolf-1", species: "shadow_wolf", xMin: -15, xMax: -2, zMin: 344, zMax: 382, hp: 3, speed: 3.9 },
      { id: "shadow-wolf-2", species: "shadow_wolf", xMin: 2, xMax: 15, zMin: 346, zMax: 384, hp: 3, speed: 3.9 },
      { id: "shadow-wolf-3", species: "shadow_wolf", xMin: -12, xMax: -1, zMin: 388, zMax: 416, hp: 3, speed: 4.1 },
      { id: "shadow-wolf-4", species: "shadow_wolf", xMin: 1, xMax: 12, zMin: 388, zMax: 416, hp: 3, speed: 4.1 },
      // Floor 4 (Colossal Sanctum): CERBERUS, THE 3-FACED DIRE WOLF FINAL BOSS (30 HP!)
      { id: "boss-cerberus", species: "cerberus", xMin: -12, xMax: 12, zMin: 434, zMax: 460, hp: 30, speed: 3.6 },
    ];
    for (const s of specs) {
      const animal = new ForestAnimal();
      animal.id = s.id;
      animal.species = s.species;
      animal.x = s.id === "boss-cerberus" ? 0 : s.xMin + Math.random() * (s.xMax - s.xMin);
      animal.z = s.id === "boss-cerberus" ? BRICK_DUNGEON.bossHomeZ : s.zMin + Math.random() * (s.zMax - s.zMin);
      animal.rot = s.id === "boss-cerberus" ? Math.PI : Math.random() * Math.PI * 2;
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
    if (this.state.players.size > 0) {
      let anyInSouth = false;
      for (const p of this.state.players.values()) {
        if (p.z > 45) {
          anyInSouth = true;
          break;
        }
      }
      if (!anyInSouth) return;
    }
    const now = Date.now();
    for (const [id, brain] of this.animalBrains.entries()) {
      const animal = this.state.animals.get(id);
      if (!animal) continue;

      if (animal.hp === 0) {
        if (now >= brain.respawnAt) {
          animal.hp = animal.maxHp;
          animal.x = brain.id === "boss-cerberus" ? 0 : brain.homeXMin + Math.random() * (brain.homeXMax - brain.homeXMin);
          animal.z = brain.id === "boss-cerberus" ? BRICK_DUNGEON.bossHomeZ : brain.homeZMin + Math.random() * (brain.homeZMax - brain.homeZMin);
        }
        continue;
      }

      const isAggroSpecies =
        brain.species === "snake" ||
        brain.species === "spider" ||
        brain.species === "shadow_wolf" ||
        brain.species === "cerberus";

      if (isAggroSpecies) {
        const aggroRadius = brain.species === "cerberus" ? 20.0 : brain.species === "shadow_wolf" ? 12.0 : 8.5;
        const hitRadius = brain.species === "cerberus" ? 3.8 : 1.5;
        let nearestPlayer: { sid: string; p: Player; d: number } | undefined;

        for (const [sid, p] of this.state.players.entries()) {
          if (p.seatId >= 0) continue;
          if (Math.abs(p.z - animal.z) > aggroRadius + 4) continue;
          const d = Math.hypot(p.x - animal.x, p.z - animal.z);
          if (d < aggroRadius && (!nearestPlayer || d < nearestPlayer.d)) {
            nearestPlayer = { sid, p, d };
          }
        }

        if (nearestPlayer) {
          const { sid, p, d } = nearestPlayer;
          if (d > 0.4) {
            brain.vx = ((p.x - animal.x) / d) * brain.speed * 0.86;
            brain.vz = ((p.z - animal.z) / d) * brain.speed * 0.86;
            animal.rot = Math.atan2(brain.vx, brain.vz);
          }
          if (d < hitRadius) {
            const sess = this.sessions.get(sid);
            if (sess && now - sess.lastSnakeBiteAt > 3600) {
              sess.lastSnakeBiteAt = now;
              const cl = this.clients.find((c) => c.sessionId === sid);
              if (brain.species === "cerberus") {
                p.energy = Math.max(10, p.energy - 22);
                p.z = Math.max(BRICK_DUNGEON.sanctumStartZ + 2, p.z - 4.5);
                const attacks = [
                  "❄️🐺 Cerberus's FROST HEAD blasted you with freezing mana!",
                  "🔥🐺 Cerberus's FLAME HEAD scorched you with crimson fire!",
                  "🌑🐺 Cerberus's SHADOW HEAD lunged with dark fangs!",
                ];
                const msgText = attacks[Math.floor(Math.random() * attacks.length)]!;
                cl?.send(MSG.notice, {
                  text: `${msgText} (-22 Energy — press SPACE with a Spear or Bow to fight back!)`,
                } satisfies NoticeMessage);
              } else if (brain.species === "shadow_wolf") {
                p.energy = Math.max(10, p.energy - 16);
                cl?.send(MSG.notice, {
                  text: "🌑🐺 Ambush! A Small Shadow Wolf lunged from the stairs! (-16 Energy — press SPACE to fight!)",
                } satisfies NoticeMessage);
              } else if (brain.species === "spider") {
                p.energy = Math.max(10, p.energy - 14);
                cl?.send(MSG.notice, {
                  text: "🕷️🔥 A Giant Ember Spider dropped from the brick arch and bit you! (-14 Energy — press SPACE to strike!)",
                } satisfies NoticeMessage);
              } else {
                p.energy = Math.max(10, p.energy - 15);
                cl?.send(MSG.notice, {
                  text: "🐍 Bitten by a venomous forest viper! (-15 Energy — press SPACE with a Spear/Bow to hunt it!)",
                } satisfies NoticeMessage);
              }
            }
          }
        }
      }

      if (now >= brain.changeDirAt) {
        brain.changeDirAt = now + 2200 + Math.random() * 3200;
        if (Math.random() < 0.22) {
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
      if (brain.species === "snake" && Math.hypot(nx - CAMPFIRE_BASE.x, nz - CAMPFIRE_BASE.z) < 13) {
        nz = CAMPFIRE_BASE.z + 14;
        brain.vz = Math.abs(brain.vz);
      }
      animal.x = nx;
      animal.z = nz;
    }
  }

  /**
   * Server-side simulation of the 360m-long 4-Floor Ascending Stone-Brick Dungeon:
   * - FLOOR 1 (`z = 120..210`, `y = 0m` — ❄️ ICE HEAD THEME):
   *   - Flooded Underground Canal (`z = 132..172`) with central stepping stones (`|x| <= 2.8`) & outer brick walkways (`|x| >= 11.0`)
   *   - Dripping Ceiling Grates (`z = 138, 152, 166`) that douse hand-held Torches if walked directly under
   *   - Cracked Frost-Slab Traps & Sweeping Frost-Arrow Volley (`arrowVolleyZ`)
   *   - Shifting Brick T-Junction (`z = 186..191`), 3-Chest Frost Mimic Alcove (`z = 192..208`), & Secret Bookcase (`z = 210`)
   * - FLOOR 2 (`z = 226..316`, `y = +6m` — 🔥 FIRE HEAD THEME):
   *   - Sticky Cinder-Spider Web Nets (`z = 238, 256, 274`) that tangle players until burned with a 🔥 Torch (`burnWeb`)
   *   - Swinging Molten Pendulum Blades (`z = 262, 278, 294`) & Rolling Fire-Boulder (`fireBoulderZ` in `280..314`)
   * - FLOOR 3 (`z = 332..404`, `y = +12m` — 🌑 SHADOW HEAD THEME):
   *   - Bottomless Shadow Chasm (`z = 340..368`) crossed via the Central Bridge (`|x| <= 3.2`) or Outer Shadow Catwalks (`|x| >= 11.0`)
   *   - Parallel Iron Portcullis Gates (`z = 388`) unlocked by Loose Brick Switches
   * - FLOOR 4 (`z = 420..480`, `y = +18m` — 👑 SANCTUM OF THE 3-FACED DIRE WOLF)
   */
  private tickBrickDungeon(dt: number) {
    let anyNearDungeon = this.state.players.size === 0;
    for (const p of this.state.players.values()) {
      if (p.z > 90 || p.mimicTrapped !== 0) {
        anyNearDungeon = true;
        break;
      }
    }
    if (!anyNearDungeon) return;

    // 1. Floor 1 Sweeping Frost-Arrow Volley
    let az = this.state.arrowVolleyZ - 12.5 * dt;
    if (az < BRICK_DUNGEON.startZ + 4) {
      az = BRICK_DUNGEON.hall1EndZ;
    }
    this.state.arrowVolleyZ = az;

    // 2. Floor 2 Rolling Fire-Boulder
    let bz = this.state.fireBoulderZ - 11.5 * dt;
    if (bz < BRICK_DUNGEON.boulderStartZ) {
      bz = BRICK_DUNGEON.boulderEndZ;
    }
    this.state.fireBoulderZ = bz;

    const now = Date.now();
    const cx = BRICK_DUNGEON.centerX;
    const D = BRICK_DUNGEON;

    // Doors that are solid right now: the same boxes the client collides with.
    const doors = dungeonClosedDoors(this.state);

    for (const [sid, p] of this.state.players.entries()) {
      const sess = this.sessions.get(sid);
      if (!sess) continue;
      if (!isInBrickDungeon(p.x, p.z)) {
        if (p.mimicTrapped !== 0) p.mimicTrapped = 0;
        sess.lastSafeX = p.x;
        sess.lastSafeZ = p.z;
        continue;
      }

      // ---- WALLS: always enforced, no cooldown, swept from the last safe spot ----
      // A player who is trapped in a mimic is placed by the server; skip them.
      // A jump far longer than a client can walk in one 50 ms tick is one of our
      // own teleports (knockback, escape slide, mimic release): accept it as the new
      // safe spot instead of sweeping it through every door on the way.
      const jump = Math.hypot(p.x - sess.lastSafeX, p.z - sess.lastSafeZ);
      if (p.mimicTrapped === 0 && jump < 4) {
        const crossed = this.crossedDoor(doors, sess.lastSafeX, sess.lastSafeZ, p.x, p.z, PLAYER.radius);
        // If the last safe spot is itself inside a door (the partition shifted onto you),
        // don't pin the player there; let them walk out.
        const stuck = crossed && this.crossedDoor(doors, sess.lastSafeX, sess.lastSafeZ, sess.lastSafeX, sess.lastSafeZ, PLAYER.radius);
        if (crossed && !stuck) {
          p.x = sess.lastSafeX;
          p.z = sess.lastSafeZ;
          if (now - sess.lastDoorNoticeAt > 2500) {
            sess.lastDoorNoticeAt = now;
            const cl = this.clients.find((c) => c.sessionId === sid);
            cl?.send(MSG.notice, { text: this.doorMessage(crossed.door) } satisfies NoticeMessage);
          }
        } else {
          sess.lastSafeX = p.x;
          sess.lastSafeZ = p.z;
        }
      } else {
        sess.lastSafeX = p.x;
        sess.lastSafeZ = p.z;
      }

      // ---- HAZARDS: damage with a short grace period after each hit ----
      if (now - sess.lastTrapHitAt < 1500) continue;

      // ---- FLOOR 1: FROST-FANG AQUEDUCT HALLWAY (z = 122..210) ----
      if (p.z >= 122 && p.z <= D.secretWallZ) {
        // A. Flooded Underground Ice-Water Canal
        // Safe paths: Central Ice Stepping Stones OR Outer Raised Brick Walkways
        if (p.z >= D.waterStartZ + 1 && p.z <= D.waterEndZ - 1) {
          const ax = Math.abs(p.x - cx);
          if (ax > D.canalStoneHalfW && ax < D.canalWalkwayMinX) {
            sess.lastTrapHitAt = now;
            p.z = BRICK_DUNGEON.waterStartZ - 1.5;
            p.x = 0;
            p.energy = Math.max(10, p.energy - 12);
            const cl = this.clients.find((c) => c.sessionId === sid);
            cl?.send(MSG.notice, {
              text: "🌊❄️ Splash! You slipped off the Ice Stepping-Stones into the freezing underground canal! (-12 Energy — stay on the center blocks or take the outer brick walkways!)",
            } satisfies NoticeMessage);
            continue;
          }

          // Dripping Ceiling Waterfall Grates extinguish hand-held Torches (drip side alternates per row)!
          for (let gi = 0; gi < D.grateZs.length; gi++) {
            const gz = D.grateZs[gi]!;
            const dripX = cx + (gi % 2 === 1 ? 1 : -1) * D.grateDripX;
            if (Math.abs(p.z - gz) < 1.2 && Math.abs(p.x - dripX) < D.grateDripHalfW && p.tool === TOOL.torch) {
              sess.lastTrapHitAt = now;
              p.tool = TOOL.none;
              const cl = this.clients.find((c) => c.sessionId === sid);
              cl?.send(MSG.notice, {
                text: "💧❄️ Freezing water pouring from the overhead ceiling grate extinguished your 🔥 Torch! Re-equip it from the bar once you're past the grate.",
              } satisfies NoticeMessage);
              break;
            }
          }
        }

        // B. Cracked Frost-Slab Booby Traps (same rows and widths the client draws)
        for (let r = 0; r < D.slabRowZs.length; r++) {
          const rz = D.slabRowZs[r]!;
          if (Math.abs(p.z - rz) < D.slabHalfD) {
            const crackedOnLeft = (r + this.state.dungeonSeed) % 2 === 0;
            const trapX = crackedOnLeft ? cx - D.slabCenterX : cx + D.slabCenterX;
            if (Math.abs(p.x - trapX) < D.slabHalfW) {
              sess.lastTrapHitAt = now;
              p.z = Math.max(BRICK_DUNGEON.startZ + 2, p.z - 6);
              p.energy = Math.max(10, p.energy - 16);
              const cl = this.clients.find((c) => c.sessionId === sid);
              cl?.send(MSG.notice, {
                text: "❄️🧱 *CRACK!* You stepped on a fractured frost flagstone — ice spikes knocked you back! (-16 Energy)",
              } satisfies NoticeMessage);
              break;
            }
          }
        }

        // C. Sweeping Frost-Arrow Volley (central lane only; the arrows are drawn exactly this wide)
        if (Math.abs(p.z - this.state.arrowVolleyZ) < D.arrowHalfD && Math.abs(p.x - cx) < D.arrowHalfW) {
          sess.lastTrapHitAt = now;
          p.z = Math.max(BRICK_DUNGEON.startZ + 2, p.z - 5);
          p.energy = Math.max(10, p.energy - 14);
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "🏹❄️ Struck by the Frost-Arrow Volley! Step onto the outer brick walkways or side niches as arrows fly past (-14 Energy).",
          } satisfies NoticeMessage);
          continue;
        }

        // (The shifting partition and the secret bookcase are solid walls now; see the WALLS block above.)
      }

      // ---- FLOOR 2: CRIMSON-EMBER & SPIDER-WEB HALLWAY (z = 226..316) ----
      if (p.z >= D.stairs1EndZ && p.z <= D.floor2EndZ) {
        // A. Web curtains are solid walls (see above) until a torch touches them: standing
        //    against a web with a torch burns it. No torch: you just can't pass the centre.
        const webZs = [D.web1Z, D.web2Z, D.web3Z];
        for (let i = 0; i < webZs.length; i++) {
          const wz = webZs[i]!;
          const bit = 1 << i;
          if (
            (this.state.websBurned & bit) === 0 &&
            p.tool === TOOL.torch &&
            Math.abs(p.z - wz) < D.webHalfD + PLAYER.radius + 0.6 &&
            Math.abs(p.x - cx) < D.webHalfW
          ) {
            this.state.websBurned |= bit;
            this.broadcast(MSG.notice, {
              text: `🔥🕸️ ${p.name}'s flaming Torch burned away Spiderweb Curtain #${i + 1} on Floor 2!`,
            } satisfies NoticeMessage);
          }
        }

        // B. Rolling Fire-Boulder in the central groove
        if (Math.abs(p.z - this.state.fireBoulderZ) < D.boulderRadius * 0.7 && Math.abs(p.x - cx) < D.boulderHitHalfW) {
          sess.lastTrapHitAt = now;
          p.z = Math.max(BRICK_DUNGEON.boulderStartZ - 2, p.z - 6);
          p.energy = Math.max(10, p.energy - 18);
          const cl = this.clients.find((c) => c.sessionId === sid);
          cl?.send(MSG.notice, {
            text: "🪨🔥 Crushed by the Rolling Fire-Boulder on Floor 2! Dodge into the side walkways as it rumbles past (-18 Energy).",
          } satisfies NoticeMessage);
          continue;
        }
      }

      // ---- FLOOR 3: SHADOW-MANA CHASM & WOLF DEN HALLWAY (z = 332..404) ----
      if (p.z >= D.stairs2EndZ && p.z <= D.floor3EndZ) {
        // A. Bottomless Shadow Chasm: safe on the central bridge or the outer catwalks
        if (p.z >= D.chasmStartZ + 1 && p.z <= D.chasmEndZ - 1) {
          const ax = Math.abs(p.x - cx);
          if (ax > D.chasmBridgeHalfW && ax < D.chasmCatwalkMinX) {
            sess.lastTrapHitAt = now;
            p.z = BRICK_DUNGEON.chasmStartZ - 1.5;
            p.x = 0;
            p.energy = Math.max(10, p.energy - 18);
            const cl = this.clients.find((c) => c.sessionId === sid);
            cl?.send(MSG.notice, {
              text: "🌑🕳️ You stepped off the Shadow Bridge into the abyssal chasm! (-18 Energy — stay on the center stone bridge or the outer brick catwalks!)",
            } satisfies NoticeMessage);
            continue;
          }
        }

        // (The portcullis gates are solid walls now; see the WALLS block above.)
      }
    }
  }

  /**
   * Did the segment from (x0,z0) to (x1,z1), as a disc of `radius`, touch a
   * closed door? Swept, so a fast client can't skip a thin door between two
   * 10 Hz updates. Returns the door hit, or undefined.
   */
  private crossedDoor(doors: WallBox[], x0: number, z0: number, x1: number, z1: number, radius: number): WallBox | undefined {
    for (const d of doors) {
      const hw = d.hw + radius;
      const hd = d.hd + radius;
      // Inside the expanded box at the destination?
      if (Math.abs(x1 - d.x) < hw && Math.abs(z1 - d.z) < hd) return d;
      // Or passed straight through it along z between the two samples?
      const zA = Math.min(z0, z1);
      const zB = Math.max(z0, z1);
      if (zA < d.z - hd && zB > d.z + hd) {
        // x where the path crosses the door plane
        const t = (d.z - z0) / (z1 - z0 || 1e-6);
        const xAt = x0 + (x1 - x0) * t;
        if (Math.abs(xAt - d.x) < hw) return d;
      }
    }
    return undefined;
  }

  private doorMessage(door: WallBox["door"]): string {
    switch (door) {
      case "partition":
        return `🧱 That brick archway is sealed! Walk through the open ${this.state.dungeonWing === 1 ? "West (Left)" : "East (Right)"} side or pull a Lever (E) to shift the wall.`;
      case "bookcase":
        return "📚 The Secret Brick Bookcase blocks the Grand Staircase to Floor 2! Open the real Grimoire Chest first (watch out for Mimics!).";
      case "web1":
      case "web2":
      case "web3":
        return "🕸️ A sticky Cinder-Spider Web blocks the centre lane. Hold your 🔥 Torch against it to burn it, or take the outer galleries.";
      case "gateLeft":
      case "gateRight":
        return "⛓️🌑 The Shadow Portcullis Gate is locked! Press the Loose Brick Switch (E) on the wall to raise it.";
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
      lastSafeX: player.x,
      lastSafeZ: player.z,
      lastDoorNoticeAt: 0,
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
        text: "⚔️ Equip a 🗡️ Spear or 🏹 Bow from the Campfire or Dungeon Action Bar first to fight!",
      } satisfies NoticeMessage);
      return;
    }

    const animal = payload?.animalId ? this.state.animals.get(payload.animalId) : undefined;
    const brain = payload?.animalId ? this.animalBrains.get(payload.animalId) : undefined;
    if (!animal || !brain || animal.hp === 0) return;

    const maxRange = player.tool === TOOL.bow ? 22 : 7.5;
    const d = Math.hypot(animal.x - player.x, animal.z - player.z);
    if (d > maxRange) {
      client.send(MSG.notice, { text: "Too far away! Get closer or use the 🏹 Bow." } satisfies NoticeMessage);
      return;
    }

    player.anim = ANIM.attack;
    const dmg = animal.species === "cerberus" && player.tool === TOOL.spear ? 2 : 1;
    animal.hp = Math.max(0, animal.hp - dmg);

    if (animal.hp === 0) {
      brain.respawnAt = Date.now() + (animal.species === "cerberus" ? 45_000 : 14_000);
      if (animal.species === "cerberus") {
        player.energy = 100;
        player.cookedMeat = Math.min(20, player.cookedMeat + 3);
        this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.cheer, emoji: "👑" } satisfies EmoteBroadcast);
        this.broadcast(MSG.notice, {
          text: `👑🐺⚔️ ${player.name} slayed CERBERUS, THE 3-FACED DIRE WOLF! The Golden Royal Vault at the end of Floor 4 is now unlocked!`,
        } satisfies NoticeMessage);
      } else if (animal.species === "shadow_wolf") {
        player.rawMeat = Math.min(20, player.rawMeat + 2);
        player.energy = Math.min(100, player.energy + 18);
        client.send(MSG.notice, {
          text: `🌑🐺 Defeated Shadow Wolf guard! +2 Raw Meat 🥩 & +18 Shadow Mana Energy!`,
        } satisfies NoticeMessage);
      } else if (animal.species === "spider") {
        player.energy = Math.min(100, player.energy + 15);
        client.send(MSG.notice, {
          text: `🕷️🔥 Slayed Giant Ember Spider! +15 Energy!`,
        } satisfies NoticeMessage);
      } else if (animal.species === "snake") {
        player.rawMeat = Math.min(20, player.rawMeat + 1);
        player.energy = Math.min(100, player.energy + 15);
        client.send(MSG.notice, {
          text: `🐍 Slayed forest viper! +1 Raw Meat 🥩 & +15 Venom Antidote Energy!`,
        } satisfies NoticeMessage);
      } else {
        const meatYield = animal.species === "boar" || animal.species === "wolf" ? 2 : 1;
        player.rawMeat = Math.min(20, player.rawMeat + meatYield);
        client.send(MSG.notice, {
          text: `🏹 Hunted ${animal.species}! +${meatYield} Raw Meat 🥩 (Roast it at the Campfire!)`,
        } satisfies NoticeMessage);
      }
    } else {
      if (animal.species === "cerberus") {
        const activeHeads = animal.hp > 20 ? "❄️Frost + 🔥Fire + 🌑Shadow" : animal.hp > 10 ? "🔥Fire + 🌑Shadow" : "🌑Shadow";
        client.send(MSG.notice, {
          text: `⚔️ Struck the 3-Faced Dire Wolf (-${dmg} HP)! Boss HP: ${animal.hp}/${animal.maxHp} (${activeHeads} heads active!)`,
        } satisfies NoticeMessage);
      }
      const nx = (animal.x - player.x) / Math.max(0.5, d);
      const nz = (animal.z - player.z) / Math.max(0.5, d);
      brain.vx = nx * brain.speed * (animal.species === "cerberus" ? 0.6 : 1.5);
      brain.vz = nz * brain.speed * (animal.species === "cerberus" ? 0.6 : 1.5);
      animal.rot = Math.atan2(brain.vx, brain.vz);
      brain.changeDirAt = Date.now() + 2000;
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
   * Handles all player decisions and traps across the 360m-long 4-Floor Ascending Brick Dungeon:
   * - Floor 1 (`z = 120..210`, Ice): `lever1` / `lever2`, `chest1..3`, `rescue`, `struggle`
   * - Floor 2 (`z = 226..316`, Fire): `burnWeb` (burns sticky Cinder-Spider webs with a 🔥 Torch or 🗡️ Spear)
   * - Floor 3 (`z = 332..404`, Shadow): `switchL` / `switchR` (raises the Iron Portcullis Gates at z = 388)
   * - Floor 4 (`z = 420..480`, Boss Sanctum): `vault` (after defeating 3-Faced Dire Wolf) & `escapeSlide`
   */
  private onDungeonAction(client: Client, payload: DungeonActionMessage): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;
    if (!isInBrickDungeon(player.x, player.z)) {
      client.send(MSG.notice, { text: "🧱 Enter the 4-Floor Stone-Brick Dungeon across the Southern Bridge first!" } satisfies NoticeMessage);
      return;
    }

    const act = payload?.action;

    // 1. Rescue a friend stuck in a Mimic Chest!
    if (act === "rescue") {
      for (const [sid, p] of this.state.players.entries()) {
        if (sid !== client.sessionId && p.mimicTrapped > 0) {
          p.mimicTrapped = 0;
          p.z = BRICK_DUNGEON.mimicRoomStartZ + 4;
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
        player.z = BRICK_DUNGEON.mimicRoomStartZ + 4;
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

    // 3. Floor 1 Decision: Shifting Brick T-Junction Levers (lever1 = West Wing, lever2 = East Wing)
    if (act === "lever1" || act === "lever2") {
      const wing = act === "lever1" ? 1 : 2;
      this.state.dungeonWing = wing;
      this.state.dungeonSeed = (this.state.dungeonSeed + 1) % 3;
      const wingName = wing === 1 ? "❄️ West Frost Wing" : "❄️ East Frost Wing";
      this.broadcast(MSG.notice, {
        text: `⚙️ ${player.name} pulled the Iron Lever — heavy stone bricks ground open to the ${wingName} and reshuffled the traps!`,
      } satisfies NoticeMessage);
      return;
    }

    // 4. Floor 1 Decision: Frieren's 3-Chest Mimic Gamble (chest1, chest2, chest3)
    if (act === "chest1" || act === "chest2" || act === "chest3") {
      const chestNum = act === "chest1" ? 1 : act === "chest2" ? 2 : 3;
      const realChest = (this.state.dungeonSeed % 3) + 1;
      const chestXs: Record<number, number> = {
        1: BRICK_DUNGEON.centerX + BRICK_DUNGEON.chestXs[0],
        2: BRICK_DUNGEON.centerX + BRICK_DUNGEON.chestXs[1],
        3: BRICK_DUNGEON.centerX + BRICK_DUNGEON.chestXs[2],
      };

      if (chestNum === realChest) {
        this.state.grimoireFound = 1;
        player.energy = Math.min(100, player.energy + 45);
        this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.cheer, emoji: "📖" } satisfies EmoteBroadcast);
        this.broadcast(MSG.notice, {
          text: `📖✨ 1% Legendary Grimoire! ${player.name} opened Chest #${chestNum} and found the Grimoire Key — the Secret Brick Bookcase Wall to Floor 2 slid open!`,
        } satisfies NoticeMessage);
      } else {
        player.mimicTrapped = chestNum;
        session.mimicStruggles = 0;
        player.x = chestXs[chestNum] ?? 0;
        player.z = BRICK_DUNGEON.chestZ;
        player.rot = 0;
        player.energy = Math.max(15, player.energy - 15);
        this.broadcast(MSG.emote, { id: client.sessionId, anim: ANIM.mindblown, emoji: "🦷" } satisfies EmoteBroadcast);
        this.broadcast(MSG.notice, {
          text: `📦🦷 CHOMP! Chest #${chestNum} is a MIMIC! ${player.name} is stuck head-first inside ("It's dark and scary! Pull me out!")!`,
        } satisfies NoticeMessage);
      }
      return;
    }

    // 5. Floor 2 Action: Burn or Slash Sticky Cinder-Spider Webs (`burnWeb`)
    if (act === "burnWeb") {
      if (player.tool !== TOOL.torch && player.tool !== TOOL.spear) {
        player.tool = TOOL.torch;
      }
      const webZs = [BRICK_DUNGEON.web1Z, BRICK_DUNGEON.web2Z, BRICK_DUNGEON.web3Z];
      let burnedAny = false;
      webZs.forEach((wz, idx) => {
        const bit = 1 << idx;
        if (Math.abs(player.z - wz) < 9.5 && (this.state.websBurned & bit) === 0) {
          this.state.websBurned |= bit;
          burnedAny = true;
        }
      });
      if (!burnedAny && this.state.websBurned < 7) {
        this.state.websBurned = 7;
        burnedAny = true;
      }
      if (burnedAny) {
        this.broadcast(MSG.notice, {
          text: `🔥🕸️ ${player.name} torched the sticky Cinder-Spider Webs blocking Floor 2!`,
        } satisfies NoticeMessage);
      } else {
        client.send(MSG.notice, { text: "🔥 All Spiderweb Nets on Floor 2 are already burned clear!" } satisfies NoticeMessage);
      }
      return;
    }

    // 6. Floor 3 Action: Parallel Iron-Bar Corridor Loose Brick Switches (switchL, switchR)
    if (act === "switchL" || act === "switchR") {
      this.state.gateLeftOpen = 1;
      this.state.gateRightOpen = 1;
      this.broadcast(MSG.notice, {
        text: `🧱⛓️ ${player.name} pressed the glowing loose brick on Floor 3 — the Iron Portcullis Gates to the Grand Boss Staircase ground open!`,
      } satisfies NoticeMessage);
      return;
    }

    // 7. Floor 4 Action: Waterfall Return Escape Slide back to Floor 1 Entrance
    if (act === "escapeSlide") {
      player.x = 0;
      player.z = BRICK_DUNGEON.startZ + 2;
      player.y = 0;
      client.send(MSG.notice, {
        text: "🌊🛷 Whoosh! You rode the Underground Aqueduct Slide all the way back to the Floor 1 Entrance!",
      } satisfies NoticeMessage);
      return;
    }

    // 8. Floor 4 Sanctum: The King's Tomb Golden Vault (guarded by Cerberus!)
    if (act === "vault") {
      const boss = this.state.animals.get("boss-cerberus");
      if (boss && boss.hp > 0) {
        client.send(MSG.notice, {
          text: `🐺🔥❄️🌑 CERBERUS (${boss.hp}/${boss.maxHp} HP) blocks the Golden Royal Vault! Press SPACE with a 🗡️ Spear or 🏹 Bow to defeat the 3-Faced Dire Wolf first!`,
        } satisfies NoticeMessage);
        return;
      }

      this.state.vaultUnlocked = 1;
      for (const [sid, p] of this.state.players.entries()) {
        if (isInBrickDungeon(p.x, p.z)) {
          p.energy = 100;
          p.cookedMeat = Math.min(20, p.cookedMeat + 5);
          p.mimicTrapped = 0;
          this.broadcast(MSG.emote, { id: sid, anim: ANIM.mindblown, emoji: "👑" } satisfies EmoteBroadcast);
        }
      }
      this.broadcast(MSG.notice, {
        text: `👑🐺📖 ${player.name} unlocked the Golden Royal Vault of the 3-Faced Wolf! Everyone in the dungeon received 100% Energy & +5 Cooked Steaks 🍖!`,
      } satisfies NoticeMessage);

      if (this.dungeonResetTimer) clearTimeout(this.dungeonResetTimer);
      this.dungeonResetTimer = setTimeout(() => {
        this.state.dungeonSeed = (this.state.dungeonSeed + 1) % 3;
        this.state.dungeonWing = this.state.dungeonWing === 1 ? 2 : 1;
        this.state.grimoireFound = 0;
        this.state.websBurned = 0;
        this.state.gateLeftOpen = 0;
        this.state.gateRightOpen = 0;
        this.state.vaultUnlocked = 0;
      }, 30_000);
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
      const inside = (p.seatId >= 0 && p.seatId < CINEMA_HALL.seatCount) || isInCinemaHall(p.x, p.z);
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

    const wasInCinema = (player.seatId >= 0 && player.seatId < CINEMA_HALL.seatCount) || isInCinemaHall(player.x, player.z);
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

    const nowInCinema = (player.seatId >= 0 && player.seatId < CINEMA_HALL.seatCount) || isInCinemaHall(player.x, player.z);
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
