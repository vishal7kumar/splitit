import api from "../lib/axios";

export interface GroupActivity {
  id: number;
  group_id: number;
  expense_id: number | null;
  user_id: number;
  user_name: string;
  action: "create" | "update" | "delete" | "comment" | "settlement";
  summary: string;
  created_at: string;
}

export function listGroupActivity(groupId: number): Promise<GroupActivity[]> {
  return api.get(`/api/groups/${groupId}/activity`).then((r) => r.data);
}
