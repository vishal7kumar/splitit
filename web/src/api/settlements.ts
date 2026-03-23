import api from "../lib/axios";

export interface Settlement {
  id: number;
  group_id: number;
  paid_by: number;
  paid_to: number;
  amount: number;
  date: string;
  created_at: string;
  paid_by_name: string;
  paid_to_name: string;
}

export interface BalanceEntry {
  user_id: number;
  name: string;
  balance: number;
}

export interface SimplifiedDebt {
  from: number;
  from_name: string;
  to: number;
  to_name: string;
  amount: number;
}

export interface GroupBalances {
  balances: BalanceEntry[];
  debts: SimplifiedDebt[];
}

export interface TotalBalance {
  total_balance: number;
  groups: {
    group_id: number;
    name: string;
    currency: string;
    balance: number;
  }[];
}

export function getGroupBalances(groupId: number): Promise<GroupBalances> {
  return api.get(`/api/groups/${groupId}/balances`).then((r) => r.data);
}

export function getTotalBalance(): Promise<TotalBalance> {
  return api.get("/api/user/total-balance").then((r) => r.data);
}

export function createSettlement(
  groupId: number,
  paidTo: number,
  amount: number,
  date?: string
): Promise<Settlement> {
  return api
    .post(`/api/groups/${groupId}/settlements`, {
      paid_to: paidTo,
      amount,
      date,
    })
    .then((r) => r.data);
}

export function listSettlements(groupId: number): Promise<Settlement[]> {
  return api.get(`/api/groups/${groupId}/settlements`).then((r) => r.data);
}
