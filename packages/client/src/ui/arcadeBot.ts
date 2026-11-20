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
