import api from "../lib/axios";

export interface GroupActivity {
  id: number;
  group_id: number;
  group_name?: string;
  expense_id: number | null;
  user_id: number;
  user_name: string;
  action:
    | "create"
    | "update"
    | "delete"
    | "delete_expense"
    | "delete_group"
    | "restore_expense"
    | "restore_group"
    | "comment"
    | "settlement";
  summary: string;
  created_at: string;
  is_involved?: boolean;
  is_new?: boolean;
  resource_type?: "expense" | "group";
  can_revert?: boolean;
  revert_deadline?: string;
  reverted_at?: string;
  group_deleted?: boolean;
  expense_deleted?: boolean;
}

export interface RevertActivityResult {
  message: string;
  resource_type: "expense" | "group";
  group_id: number;
  expense_id?: number;
  group_name?: string;
}

export interface UserActivityPage {
  items: GroupActivity[];
  next_cursor: string;
}

export function listGroupActivity(groupId: number): Promise<GroupActivity[]> {
  return api.get(`/api/groups/${groupId}/activity`).then((r) => r.data);
}

export function listUserActivity({
  limit = 20,
  cursor,
}: {
  limit?: number;
  cursor?: string;
} = {}): Promise<UserActivityPage> {
  return api
    .get("/api/user/activity", {
      params: {
        limit,
        cursor: cursor || undefined,
      },
    })
    .then((r) => r.data);
}

export function markActivityAsRead(): Promise<{ status: string }> {
  return api.post("/api/user/activity/read").then((r) => r.data);
}

export function getUnreadActivityCount(): Promise<{ unread_count: number }> {
  return api.get("/api/user/activity/unread-count").then((r) => r.data);
}

export function revertActivity(activityId: number): Promise<RevertActivityResult> {
  return api.post(`/api/activity/${activityId}/revert`).then((r) => r.data);
}
