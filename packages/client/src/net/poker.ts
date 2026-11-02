import { Client, type Room } from "@colyseus/sdk";
import { POKER_ROOM, type PokerTableConfig } from "@vi/shared/poker";
import type { PokerTableState } from "@vi/world-server/poker-state";
import { serverUrl } from "./connection";

export type PokerRoomRef = Room<any, PokerTableState>;

/**
 * Joins the poker table room (creating it if this is the first person at the
 * table). Separate from the hub room so the hub never sees anybody's cards.
 */
export async function joinPokerTable(tableId: string, config?: Partial<PokerTableConfig>): Promise<PokerRoomRef> {
  const client = new Client(serverUrl());
  try {
    return await client.joinById<PokerTableState>(tableId);
  } catch {
    return client.create<PokerTableState>(POKER_ROOM, { tableId, config });
  }
}
