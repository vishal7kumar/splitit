import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../../lib/formatDate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listGroups, createGroup } from "../../api/groups";

export default function GroupListPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: listGroups,
  });

  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: ({ name, currency }: { name: string; currency: string }) =>
      createGroup(name, currency),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setName("");
      setError("");
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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Groups</h1>

      {error && <p className="text-red-600 text-xs font-medium mb-4">{error}</p>}
      
      <form
        onSubmit={handleCreate}
        className="bg-white border border-gray-200 rounded-xl p-4 mb-6 shadow-sm space-y-4 sm:space-y-0 sm:flex sm:items-end sm:gap-3"
      >
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Group Name</label>
          <input
            type="text"
            placeholder="e.g. Trip to Paris, Shared Apartment"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
            required
          />
        </div>
        <div className="w-full sm:w-28">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 cursor-pointer"
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
          {create.isPending ? "Creating..." : "Create Group"}
        </button>
      </form>

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
              className="flex items-center justify-between border border-gray-200 bg-white rounded-xl p-4 hover:shadow-md hover:border-gray-300 transition-all duration-200 cursor-pointer"
            >
              <div className="min-w-0 mr-3">
                <span className="font-semibold text-gray-900 block truncate">{g.name}</span>
                <span className="inline-block mt-1 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium uppercase tracking-wider">
                  {g.currency}
                </span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-[10px] text-gray-400 block mt-0.5">
                  Added {formatDate(g.created_at)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
