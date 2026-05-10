import api from "../lib/axios";

export interface GroupActivity {
  id: number;
  group_id: number;
  group_name?: string;
  expense_id: number | null;
  user_id: number;
  user_name: string;
  action: "create" | "update" | "delete" | "comment" | "settlement";
  summary: string;
  created_at: string;
  is_involved?: boolean;
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
