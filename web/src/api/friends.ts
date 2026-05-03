import api from "../lib/axios";

export interface FriendGroupBreakdown {
  group_id: number;
  name: string;
  currency: string;
  balance: number;
  direction: "owed_to_you" | "you_owe";
  amount: number;
}

export interface FriendSummary {
  user_id: number;
  name: string;
  email: string;
  total_balance: number;
  groups: FriendGroupBreakdown[];
}

export interface FriendSettlement {
  id: number;
  group_id: number;
  paid_by: number;
  paid_to: number;
  amount: number;
  date: string;
  created_at: string;
}

export function listFriends(): Promise<FriendSummary[]> {
  return api.get("/api/user/friends").then((r) => r.data);
}

export function settleFriend(friendId: number): Promise<FriendSettlement[]> {
  return api.post(`/api/user/friends/${friendId}/settle`).then((r) => r.data);
}
