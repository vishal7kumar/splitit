import api from "../lib/axios";

export interface Group {
  id: number;
  name: string;
  currency: string;
  created_by: number;
  created_at: string;
}

export interface GroupMember {
  group_id: number;
  user_id: number;
  role: string;
  joined_at: string;
  name: string;
  email: string;
}

export interface GroupDetail {
  group: Group;
  members: GroupMember[];
}

export function listGroups(): Promise<Group[]> {
  return api.get("/api/groups").then((r) => r.data);
}

export function getGroup(id: number): Promise<GroupDetail> {
  return api.get(`/api/groups/${id}`).then((r) => r.data);
}

export function createGroup(name: string, currency?: string): Promise<Group> {
  return api.post("/api/groups", { name, currency }).then((r) => r.data);
}

export function updateGroup(
  id: number,
  data: { name: string; currency: string }
): Promise<Group> {
  return api.put(`/api/groups/${id}`, data).then((r) => r.data);
}

export function deleteGroup(id: number) {
  return api.delete(`/api/groups/${id}`);
}

export function addMember(groupId: number, email: string) {
  return api.post(`/api/groups/${groupId}/members`, { email });
}

export function removeMember(groupId: number, userId: number) {
  return api.delete(`/api/groups/${groupId}/members/${userId}`);
}
