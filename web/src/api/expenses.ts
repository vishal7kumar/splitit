import api from "../lib/axios";

export interface Expense {
  id: number;
  group_id: number;
  paid_by: number;
  amount: number;
  description: string;
  category: string;
  date: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseSplit {
  id: number;
  expense_id: number;
  user_id: number;
  share_amount: number;
}

export interface ExpenseComment {
  id: number;
  expense_id: number;
  user_id: number;
  user_name: string;
  body: string;
  created_at: string;
}

export interface ExpenseHistory {
  id: number;
  expense_id: number;
  user_id: number;
  user_name: string;
  action: string;
  summary: string;
  created_at: string;
}

export interface ExpenseWithSplits {
  expense: Expense;
  splits: ExpenseSplit[];
  comments?: ExpenseComment[];
  history?: ExpenseHistory[];
}

export interface SplitEntry {
  user_id: number;
  share_amount?: number;
  percentage?: number;
  shares?: number;
}

export interface CreateExpensePayload {
  amount: number;
  description: string;
  category?: string;
  date?: string;
  paid_by?: number;
  split_type: "equal" | "exact" | "percentage" | "shares";
  splits: SplitEntry[];
}

export interface ExpenseFilters {
  q?: string;
  category?: string;
  paid_by?: string;
  from?: string;
  to?: string;
}

export function listExpenses(
  groupId: number,
  filters?: ExpenseFilters
): Promise<Expense[]> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
  }
  const qs = params.toString();
  return api
    .get(`/api/groups/${groupId}/expenses${qs ? `?${qs}` : ""}`)
    .then((r) => r.data);
}

export function getExpense(
  groupId: number,
  expenseId: number
): Promise<ExpenseWithSplits> {
  return api
    .get(`/api/groups/${groupId}/expenses/${expenseId}`)
    .then((r) => r.data);
}

export function createExpense(
  groupId: number,
  payload: CreateExpensePayload
): Promise<ExpenseWithSplits> {
  return api
    .post(`/api/groups/${groupId}/expenses`, payload)
    .then((r) => r.data);
}

export function updateExpense(
  groupId: number,
  expenseId: number,
  payload: CreateExpensePayload
): Promise<ExpenseWithSplits> {
  return api
    .put(`/api/groups/${groupId}/expenses/${expenseId}`, payload)
    .then((r) => r.data);
}

export function deleteExpense(groupId: number, expenseId: number) {
  return api.delete(`/api/groups/${groupId}/expenses/${expenseId}`);
}

export function addExpenseComment(
  groupId: number,
  expenseId: number,
  body: string
): Promise<ExpenseComment> {
  return api
    .post(`/api/groups/${groupId}/expenses/${expenseId}/comments`, { body })
    .then((r) => r.data);
}
