import { Link } from "react-router-dom";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { getTotalBalance } from "../../api/settlements";
import { createGroup } from "../../api/groups";
import { formatCurrency } from "../../lib/currency";

export default function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupCurrency, setNewGroupCurrency] = useState("INR");
  const [createError, setCreateError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["total-balance"],
    queryFn: getTotalBalance,
  });

  const create = useMutation({
    mutationFn: ({ name, currency }: { name: string; currency: string }) =>
      createGroup(name, currency),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      setNewGroupName("");
      setCreateError("");
      setShowCreateForm(false);
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      setCreateError(err.response?.data?.error || "Failed to create group");
    },
  });

  function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (newGroupName.trim()) {
      create.mutate({ name: newGroupName.trim(), currency: newGroupCurrency });
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-1 text-sm text-gray-500 mb-6">
        Welcome back, {user?.name || user?.email}!
      </p>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">Loading dashboard details...</p>
        </div>
      ) : (
        <>
          {/* Groups Section (at the top) */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Groups</h2>
              <button
                type="button"
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-sm transition-all duration-200 cursor-pointer"
              >
                {showCreateForm ? "Cancel" : "+ New Group"}
              </button>
            </div>

            {showCreateForm && (
              <form
                onSubmit={handleCreateGroup}
                className="bg-white border border-gray-200 rounded-xl p-4 mb-4 shadow-sm"
              >
                <h3 className="text-sm font-bold text-gray-900 mb-3">Create a new group</h3>
                {createError && <p className="text-red-600 text-xs mb-3">{createError}</p>}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Group Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Apartment, Trip to Goa"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>
                  <div className="w-full sm:w-28">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Currency</label>
                    <select
                      value={newGroupCurrency}
                      onChange={(e) => setNewGroupCurrency(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
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
                    className="w-full sm:w-auto bg-blue-600 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                  >
                    {create.isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            )}

            {(!data || data.groups.length === 0) ? (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-center">
                <p className="text-gray-500 text-sm mb-1">No groups yet.</p>
                <p className="text-gray-400 text-xs">Create a group using the button above to start splitting expenses!</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.groups.map((g) => (
                  <Link
                    key={g.group_id}
                    to={`/groups/${g.group_id}`}
                    className="flex items-center justify-between border border-gray-200 bg-white rounded-xl p-4 hover:shadow-md hover:border-gray-300 transition-all duration-200 cursor-pointer"
                  >
                    <div className="min-w-0 mr-3">
                      <span className="font-semibold text-gray-900 block truncate">{g.name}</span>
                      <span className="inline-block mt-1 text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium uppercase tracking-wider">
                        {g.currency}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`font-bold text-sm block ${
                          g.balance > 0.005 ? "text-green-600" : g.balance < -0.005 ? "text-red-600" : "text-gray-500"
                        }`}
                      >
                        {g.balance > 0.005 ? "+" : ""}
                        {formatCurrency(g.currency, g.balance)}
                      </span>
                      <span className="text-[10px] text-gray-400 block mt-0.5">
                        {g.balance > 0.005 ? "you are owed" : g.balance < -0.005 ? "you owe" : "settled up"}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Overall Balance Summary Card */}
          {data && (
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Overall Balance</p>
              <p
                className={`text-3xl font-extrabold mt-1 ${
                  data.total_balance > 0.005 ? "text-green-600" : data.total_balance < -0.005 ? "text-red-600" : "text-gray-600"
                }`}
              >
                {data.total_balance > 0.005 ? "+" : ""}
                {formatCurrency(data.groups[0]?.currency || "INR", data.total_balance)}
              </p>
              <p className="text-xs text-gray-400 mt-2 font-medium">
                {data.total_balance > 0.005
                  ? "Others owe you overall across all groups"
                  : data.total_balance < -0.005
                    ? "You owe others overall across all groups"
                    : "You are all settled up everywhere! 🎉"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
