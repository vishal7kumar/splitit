import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../lib/formatDate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listGroups, createGroup } from "../../api/groups";

export default function GroupListPage() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [error, setError] = useState("");

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: listGroups,
  });

  const create = useMutation({
    mutationFn: ({ name, currency }: { name: string; currency: string }) =>
      createGroup(name, currency),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setName("");
      setError("");
      setShowCreateForm(false);
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      setError(err.response?.data?.error || "Failed to create group");
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate({ name: name.trim(), currency });
  }

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your groups and split expenses.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreateForm(!showCreateForm);
            setError("");
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-all duration-200 cursor-pointer shrink-0"
        >
          {showCreateForm ? "Cancel" : "+ New Group"}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 mb-6 shadow-sm"
        >
          <h3 className="text-sm font-bold text-gray-900 mb-3">Create a new group</h3>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs font-medium mb-4">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Group Name</label>
              <input
                type="text"
                placeholder="e.g. Trip to Paris, Shared Apartment"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 shadow-xs"
                required
              />
            </div>
            <div className="w-full sm:w-28">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 cursor-pointer shadow-xs"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={create.isPending}
              className="w-full sm:w-auto bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all duration-200 cursor-pointer shadow-sm shrink-0"
            >
              {create.isPending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">Loading groups...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center shadow-sm">
          <p className="text-gray-500 text-sm mb-1">No groups yet.</p>
          <p className="text-gray-400 text-xs">Create a group above to start tracking split expenses!</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <Link
              key={g.id}
              to={`/groups/${g.id}`}
              className="group flex items-center justify-between border border-gray-200 bg-white rounded-xl p-4 hover:shadow-md hover:border-gray-300 transition-all duration-200 cursor-pointer"
            >
              <div className="min-w-0 mr-3">
                <span className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors block truncate">
                  {g.name}
                </span>
                <span className="inline-block mt-1 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider">
                  {g.currency}
                </span>
              </div>
              <div className="text-right shrink-0 flex items-center gap-2.5">
                <span className="text-[10px] text-gray-400 block font-medium">
                  Added {formatDate(g.created_at)}
                </span>
                <svg
                  className="w-4 h-4 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
