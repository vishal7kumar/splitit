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
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Groups</h1>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <form onSubmit={handleCreate} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 mb-6 sm:flex">
        <input
          type="text"
          placeholder="New group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="col-span-2 min-w-0 border rounded px-3 py-2 sm:col-span-1 sm:flex-1"
          required
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="min-w-0 border rounded px-2 py-2"
        >
          <option value="INR">INR</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
          <option value="GBP">GBP</option>
        </select>
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {create.isPending ? "Creating..." : "Create"}
        </button>
      </form>

      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-gray-500">No groups yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}`}
                className="block min-w-0 border rounded p-4 hover:bg-gray-50"
              >
                <span className="font-medium break-words">{g.name}</span>
                <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 ml-2">
                  {g.currency}
                </span>
                <span className="text-gray-400 text-sm ml-2">
                  {formatDate(g.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
