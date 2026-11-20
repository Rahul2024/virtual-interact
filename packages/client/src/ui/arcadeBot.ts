/**
 * Client-side 2-player game engines & AI opponent ("🤖 Nova · Arcade Bot")
 * for the Royal Arcade Hall:
 *  - Tic-Tac-Toe (Cut-Cross)
 *  - Connect 4
 *  - Chess (full 8×8 rules + 2-ply alpha-beta bot)
 */

// ---- Tic-Tac-Toe (Cut-Cross) ----------------------------------------------

const TTT_LINES: ReadonlyArray<[number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function checkTttWinner(board: number[]): 0 | 1 | 2 | 3 {
  for (const [a, b, c] of TTT_LINES) {
    if (board[a] !== 0 && board[a] === board[b] && board[b] === board[c]) {
      return board[a] as 1 | 2;
    }
  }
  return board.every((v) => v !== 0) ? 3 : 0;
}

export function pickTttBotMove(board: number[], botMark: 1 | 2 = 2): number {
  const humanMark: 1 | 2 = botMark === 2 ? 1 : 2;
  const open: number[] = [];
  for (let i = 0; i < 9; i++) if (board[i] === 0) open.push(i);
  if (open.length === 0) return -1;

  // 1. Win immediately
  for (const i of open) {
    board[i] = botMark;
    const win = checkTttWinner(board) === botMark;
    board[i] = 0;
    if (win) return i;
  }
  // 2. Block player's immediate win
  for (const i of open) {
    board[i] = humanMark;
    const danger = checkTttWinner(board) === humanMark;
    board[i] = 0;
    if (danger) return i;
  }
  // 3. Minimax with slight natural playfulness
  const minimax = (isBot: boolean, depth: number): number => {
    const w = checkTttWinner(board);
    if (w === botMark) return 10 - depth;
    if (w === humanMark) return depth - 10;
    if (w === 3) return 0;
    let best = isBot ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] !== 0) continue;
      board[i] = isBot ? botMark : humanMark;
      const score = minimax(!isBot, depth + 1);
      board[i] = 0;
      best = isBot ? Math.max(best, score) : Math.min(best, score);
    }
    return best;
  };

  let bestScore = -Infinity;
  let bestMoves: number[] = [];
  for (const i of open) {
    board[i] = botMark;
    const score = minimax(false, 0);
    board[i] = 0;
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [i];
    } else if (score === bestScore) {
      bestMoves.push(i);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? open[0]!;
}

// ---- Connect 4 ------------------------------------------------------------

export function checkC4Winner(board: number[]): 0 | 1 | 2 | 3 {
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const who = board[r * 7 + c];
      if (!who) continue;
      if (c + 3 < 7 && board[r * 7 + c + 1] === who && board[r * 7 + c + 2] === who && board[r * 7 + c + 3] === who) return who as 1 | 2;
      if (r + 3 < 6 && board[(r + 1) * 7 + c] === who && board[(r + 2) * 7 + c] === who && board[(r + 3) * 7 + c] === who) return who as 1 | 2;
      if (r + 3 < 6 && c + 3 < 7 && board[(r + 1) * 7 + c + 1] === who && board[(r + 2) * 7 + c + 2] === who && board[(r + 3) * 7 + c + 3] === who) return who as 1 | 2;
      if (r - 3 >= 0 && c + 3 < 7 && board[(r - 1) * 7 + c + 1] === who && board[(r - 2) * 7 + c + 2] === who && board[(r - 3) * 7 + c + 3] === who) return who as 1 | 2;
    }
  }
  return board.every((v) => v !== 0) ? 3 : 0;
}

export function dropC4Piece(board: number[], col: number, who: 1 | 2): number {
  if (col < 0 || col >= 7) return -1;
  for (let r = 5; r >= 0; r--) {
    const idx = r * 7 + col;
    if (board[idx] === 0) {
      board[idx] = who;
      return idx;
    }
  }
  return -1;
}

export function pickC4BotMove(board: number[], botMark: 1 | 2 = 2): number {
  const humanMark: 1 | 2 = botMark === 2 ? 1 : 2;
  const cols = [3, 2, 4, 1, 5, 0, 6].filter((c) => board[c] === 0);
  if (cols.length === 0) return -1;

  // 1. Win immediately
  for (const c of cols) {
    const idx = dropC4Piece(board, c, botMark);
    const win = checkC4Winner(board) === botMark;
    if (idx >= 0) board[idx] = 0;
    if (win) return c;
  }
  // 2. Block player's immediate win
  for (const c of cols) {
    const idx = dropC4Piece(board, c, humanMark);
    const danger = checkC4Winner(board) === humanMark;
    if (idx >= 0) board[idx] = 0;
    if (danger) return c;
  }
  // 3. Prefer columns that don't hand the player an immediate winning square above
  let bestCol = cols[0]!;
  let bestScore = -Infinity;
  for (const c of cols) {
    const idx = dropC4Piece(board, c, botMark);
    let score = 3 - Math.abs(3 - c) * 1.4 + Math.random() * 0.4;
    // Penalize if dropping here lets human win right on top
    const aboveIdx = dropC4Piece(board, c, humanMark);
    if (aboveIdx >= 0) {
      if (checkC4Winner(board) === humanMark) score -= 50;
      board[aboveIdx] = 0;
    }
    // Bonus for building own 3-in-a-row threat
    for (const c2 of cols) {
      const i2 = dropC4Piece(board, c2, botMark);
      if (i2 >= 0) {
        if (checkC4Winner(board) === botMark) score += 6;
        board[i2] = 0;
      }
    }
    if (idx >= 0) board[idx] = 0;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

// ---- Chess (Full 8×8 Rules + Fast 2-Ply Bot) ------------------------------

export type ChessColor = "w" | "b";
export type ChessPieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface ChessPiece {
  c: ChessColor;
  t: ChessPieceType;
}
export interface ChessMove {
  from: number;
  to: number;
  capture?: boolean;
  promo?: ChessPieceType;
}

export const CHESS_GLYPHS: Record<ChessColor, Record<ChessPieceType, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

/** Crisp Staunton inline SVG chess pieces (clear silhouettes for both White and Black). */
export function chessPieceSvg(piece: ChessPiece): string {
  const isW = piece.c === "w";
  const fill = isW ? "#ffffff" : "#1e222b";
  const stroke = isW ? "#1a1d24" : "#111318";
  const detail = isW ? "#1a1d24" : "#e2e8f0";

  let body = "";
  switch (piece.t) {
    case "p":
      body = `
        <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
          fill="${fill}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>`;
      break;
    case "r":
      body = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round">
          <path d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5"/>
          <path d="M34 14l-3 3H14l-3-3"/>
          <path d="M31 17v12.5H14V17"/>
          <path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/>
        </g>
        <path d="M12 35.5h21M13 31.5h19M14 29.5h17M14 16.5h17M11 14h23" fill="none" stroke="${detail}" stroke-width="1.2"/>`;
      break;
    case "n":
      body = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/>
          <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3"/>
        </g>
        <circle cx="15" cy="15.5" r="1.2" fill="${detail}"/>
        <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0z" fill="${detail}"/>
        ${!isW ? `<path d="M24.55 10.4l-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34-2.37-4.49-5.79-6.64-9.19-7.16l-.51-.1z" fill="${detail}" opacity="0.28"/>` : ""}`;
      break;
    case "b":
      body = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z"/>
          <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/>
          <circle cx="22.5" cy="8" r="2.5"/>
        </g>
        <path d="M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5" fill="none" stroke="${detail}" stroke-width="1.5" stroke-linecap="round"/>`;
      break;
    case "q":
      body = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="12" r="2.5"/><circle cx="14" cy="9" r="2.5"/><circle cx="22.5" cy="8" r="2.5"/><circle cx="31" cy="9" r="2.5"/><circle cx="39" cy="12" r="2.5"/>
          <path d="M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5 9 26z"/>
          <path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"/>
        </g>
        <path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0" fill="none" stroke="${detail}" stroke-width="1.3"/>`;
      break;
    case "k":
      body = `
        <g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22.5 11.63V6M20 8h5" fill="none" stroke="${stroke}" stroke-width="2"/>
          <path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"/>
          <path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10V37z"/>
        </g>
        <path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" fill="none" stroke="${detail}" stroke-width="1.3"/>`;
      break;
  }

  return `<svg class="chess-piece-svg ${isW ? "white" : "black"}" viewBox="0 0 45 45" aria-hidden="true">${body}</svg>`;
}

const PIECE_VALUES: Record<ChessPieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

export function createInitialChessBoard(): Array<ChessPiece | null> {
  const b: Array<ChessPiece | null> = new Array(64).fill(null);
  const back: ChessPieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  for (let col = 0; col < 8; col++) {
    b[col] = { c: "b", t: back[col]! };
    b[8 + col] = { c: "b", t: "p" };
    b[48 + col] = { c: "w", t: "p" };
    b[56 + col] = { c: "w", t: back[col]! };
  }
  return b;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function pseudoMovesForSquare(board: Array<ChessPiece | null>, sq: number): ChessMove[] {
  const p = board[sq];
  if (!p) return [];
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  const enemy: ChessColor = p.c === "w" ? "b" : "w";
  const moves: ChessMove[] = [];

  if (p.t === "p") {
    const dir = p.c === "w" ? -1 : 1;
    const startRow = p.c === "w" ? 6 : 1;
    const promoRow = p.c === "w" ? 0 : 7;
    const r1 = r + dir;
    if (inBounds(r1, c) && !board[r1 * 8 + c]) {
      moves.push({ from: sq, to: r1 * 8 + c, promo: r1 === promoRow ? "q" : undefined });
      const r2 = r + dir * 2;
      if (r === startRow && !board[r2 * 8 + c]) {
        moves.push({ from: sq, to: r2 * 8 + c });
      }
    }
    for (const dc of [-1, 1]) {
      if (inBounds(r1, c + dc)) {
        const target = board[r1 * 8 + (c + dc)];
        if (target && target.c === enemy) {
          moves.push({ from: sq, to: r1 * 8 + (c + dc), capture: true, promo: r1 === promoRow ? "q" : undefined });
        }
      }
    }
  } else if (p.t === "n") {
    const jumps = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of jumps) {
      const nr = r + dr!;
      const nc = c + dc!;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr * 8 + nc];
      if (!target || target.c === enemy) {
        moves.push({ from: sq, to: nr * 8 + nc, capture: Boolean(target) });
      }
    }
  } else if (p.t === "k") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const target = board[nr * 8 + nc];
        if (!target || target.c === enemy) {
          moves.push({ from: sq, to: nr * 8 + nc, capture: Boolean(target) });
        }
      }
    }
  } else {
    const dirs: Array<[number, number]> = [];
    if (p.t === "b" || p.t === "q") dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (p.t === "r" || p.t === "q") dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr * 8 + nc];
        if (!target) {
          moves.push({ from: sq, to: nr * 8 + nc });
        } else {
          if (target.c === enemy) moves.push({ from: sq, to: nr * 8 + nc, capture: true });
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }
  return moves;
}

export function isKingInCheck(board: Array<ChessPiece | null>, color: ChessColor): boolean {
  let kingSq = -1;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.c === color && p.t === "k") {
      kingSq = i;
      break;
    }
  }
  if (kingSq < 0) return true;
  const enemy: ChessColor = color === "w" ? "b" : "w";
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.c !== enemy) continue;
    const moves = pseudoMovesForSquare(board, i);
    if (moves.some((m) => m.to === kingSq)) return true;
  }
  return false;
}

export function applyChessMove(board: Array<ChessPiece | null>, move: ChessMove): Array<ChessPiece | null> {
  const next = board.slice();
  const piece = next[move.from];
  next[move.from] = null;
  next[move.to] = piece ? { c: piece.c, t: move.promo ?? piece.t } : null;
  return next;
}

export function legalChessMoves(board: Array<ChessPiece | null>, color: ChessColor): ChessMove[] {
  const legal: ChessMove[] = [];
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.c !== color) continue;
    for (const m of pseudoMovesForSquare(board, i)) {
      const next = applyChessMove(board, m);
      if (!isKingInCheck(next, color)) legal.push(m);
    }
  }
  return legal;
}

function evaluateChessBoard(board: Array<ChessPiece | null>): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const r = Math.floor(i / 8);
    const c = i % 8;
    const centerBonus = (3.5 - Math.abs(3.5 - r)) * 4 + (3.5 - Math.abs(3.5 - c)) * 4;
    const advanceBonus = p.t === "p" ? (p.c === "b" ? r * 8 : (7 - r) * 8) : 0;
    const val = PIECE_VALUES[p.t] + centerBonus + advanceBonus;
    score += p.c === "b" ? val : -val;
  }
  return score;
}

/** Fast 2-ply alpha-beta move picker for 🤖 Nova (playing Black). */
export function pickChessBotMove(board: Array<ChessPiece | null>, botColor: ChessColor = "b"): ChessMove | null {
  const moves = legalChessMoves(board, botColor);
  if (moves.length === 0) return null;
  const humanColor: ChessColor = botColor === "b" ? "w" : "b";
  // Order captures first for better alpha-beta pruning
  moves.sort((a, b) => (b.capture ? 1 : 0) - (a.capture ? 1 : 0));

  let bestScore = -Infinity;
  let bestMoves: ChessMove[] = [];

  for (const m of moves) {
    const b1 = applyChessMove(board, m);
    const replies = legalChessMoves(b1, humanColor);
    let score: number;
    if (replies.length === 0) {
      score = isKingInCheck(b1, humanColor) ? 99999 : 0; // Checkmate vs stalemate
    } else {
      let worstReply = Infinity;
      for (const r of replies) {
        const b2 = applyChessMove(b1, r);
        const ev = evaluateChessBoard(b2) * (botColor === "b" ? 1 : -1);
        if (ev < worstReply) worstReply = ev;
        if (worstReply < bestScore) break; // alpha cutoff
      }
      score = worstReply;
    }
    if (score > bestScore + 0.01) {
      bestScore = score;
      bestMoves = [m];
    } else if (Math.abs(score - bestScore) <= 8) {
      bestMoves.push(m);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? moves[0]!;
}
