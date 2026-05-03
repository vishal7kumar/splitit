import { useState, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGroup, addMember, removeMember, deleteGroup, updateGroup } from "../../api/groups";
import { listExpenses, deleteExpense, type Expense } from "../../api/expenses";
import {
  getGroupBalances,
  createSettlement,
} from "../../api/settlements";
import { listGroupActivity } from "../../api/activity";
import { useAuth } from "../auth/useAuth";
import { formatDate } from "../../lib/formatDate";
import { formatCurrency } from "../../lib/currency";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [settleDirection, setSettleDirection] = useState<"paid" | "received">("paid");
  const [settleOtherId, setSettleOtherId] = useState<number>(0);
  const [settleAmount, setSettleAmount] = useState("");
  const [settlePrompt, setSettlePrompt] = useState<{ to: number; amount: number } | null>(null);
  const [customSettleAmount, setCustomSettleAmount] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", groupId, search],
    queryFn: () =>
      listExpenses(groupId, {
        q: search || undefined,
      }),
  });

  const { data: balanceData } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: () => getGroupBalances(groupId),
  });

  const { data: activity = [] } = useQuery({
    queryKey: ["activity", groupId],
    queryFn: () => listGroupActivity(groupId),
  });

  const settle = useMutation({
    mutationFn: ({ paidBy, paidTo, amount }: { paidBy: number; paidTo: number; amount: number }) =>
      createSettlement(groupId, paidBy, paidTo, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["settlements", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      setSettleOtherId(0);
      setSettleAmount("");
    },
  });

  const add = useMutation({
    mutationFn: (email: string) => addMember(groupId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group", groupId] });
      setEmail("");
      setError("");
    },
    onError: () => setError("Could not add member — check the email"),
  });

  const remove = useMutation({
    mutationFn: (userId: number) => removeMember(groupId, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["group", groupId] }),
  });

  const del = useMutation({
    mutationFn: () => deleteGroup(groupId),
    onSuccess: () => navigate("/groups"),
  });

  const updateCurrency = useMutation({
    mutationFn: (currency: string) =>
      updateGroup(groupId, { name: data?.group.name || "", currency }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["group", groupId] }),
  });

  const delExpense = useMutation({
    mutationFn: (eid: number) => deleteExpense(groupId, eid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["activity", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
    },
  });

  function handleAddMember(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) add.mutate(email.trim());
  }

  if (isLoading || !data) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const { group, members } = data;
  const currentMember = members.find((m) => m.user_id === user?.id);
  const isAdmin = currentMember?.role === "admin";
  const memberMap = Object.fromEntries(members.map((m) => [m.user_id, m]));
  const activityText = (summary: string, actorName: string) =>
    summary.startsWith(actorName) ? summary.slice(actorName.length).trim() : summary;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold">{group.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-500">Currency:</span>
            {isAdmin ? (
              <select
                value={group.currency}
                onChange={(e) => updateCurrency.mutate(e.target.value)}
                className="text-sm border rounded px-2 py-1"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            ) : (
              <span className="text-sm font-medium">{group.currency}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-center sm:items-start sm:justify-end">
          <Link
            to={`/groups/${groupId}/add`}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
          >
            Add Expense
          </Link>
          {isAdmin && (
            <button
              disabled={del.isPending}
              onClick={() => {
                if (confirm("Delete this group?")) del.mutate();
              }}
              className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              {del.isPending ? "Deleting..." : "Delete group"}
            </button>
          )}
        </div>
      </div>

      {/* Expenses */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Expenses</h2>
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>

        {expenses.length === 0 ? (
          <p className="text-gray-400 text-sm">No expenses yet.</p>
        ) : (
          <ul className="space-y-2">
            {expenses.map((exp: Expense) => (
              <li
                key={exp.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/groups/${groupId}/expenses/${exp.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    navigate(`/groups/${groupId}/expenses/${exp.id}`);
                  }
                }}
                className="flex flex-col gap-2 border rounded p-3 cursor-pointer hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className="font-medium break-words">
                    {exp.description || "Untitled"}
                  </span>
                  <div className="break-words text-sm text-gray-500">
                    {exp.paid_by === user?.id ? "You" : (memberMap[exp.paid_by]?.name || "Unknown")} paid{" "}
                    {formatCurrency(group.currency, exp.amount)} &middot; {formatDate(exp.date)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link
                    to={`/groups/${groupId}/expenses/${exp.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </Link>
                  <button
                    disabled={delExpense.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this expense?"))
                        delExpense.mutate(exp.id);
                    }}
                    className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Balances */}
      {balanceData && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Balances</h2>
          <ul className="space-y-1 mb-4">
            {balanceData.balances.map((b) => (
              <li key={b.user_id} className="flex justify-between gap-3 text-sm border rounded p-2">
                <span className="min-w-0 break-words">{b.user_id === user?.id ? "You" : b.name}</span>
                <span className={b.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                  {b.balance > 0 ? "+" : ""}{formatCurrency(group.currency, b.balance)}
                </span>
              </li>
            ))}
          </ul>

          {balanceData.debts.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Simplified debts</h3>
              <ul className="space-y-1 mb-4">
                {balanceData.debts.map((d, i) => (
                  <li key={i} className="flex flex-col gap-2 text-sm border rounded p-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 break-words">
                      <span className="font-medium">{d.from === user?.id ? "You" : d.from_name}</span>
                      {d.from === user?.id ? " owe " : " owes "}
                      <span className="font-medium">{d.to === user?.id ? "You" : d.to_name}</span>
                      {" "}{formatCurrency(group.currency, d.amount)}
                    </span>
                    {d.from === user?.id && (
                      settlePrompt?.to === d.to ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            disabled={settle.isPending}
                            onClick={() => {
                              settle.mutate({ paidBy: user!.id, paidTo: d.to, amount: d.amount });
                              setSettlePrompt(null);
                              setCustomSettleAmount("");
                            }}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {settle.isPending ? "Paying..." : `Full (${formatCurrency(group.currency, d.amount)})`}
                          </button>
                          <div className="flex min-w-0 items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Amount"
                              value={customSettleAmount}
                              onChange={(e) => setCustomSettleAmount(e.target.value)}
                              className="w-20 min-w-0 border rounded px-1 py-0.5 text-xs"
                            />
                            <button
                              disabled={settle.isPending}
                              onClick={() => {
                                const amt = parseFloat(customSettleAmount);
                                if (amt > 0) {
                                  settle.mutate({ paidBy: user!.id, paidTo: d.to, amount: amt });
                                  setSettlePrompt(null);
                                  setCustomSettleAmount("");
                                }
                              }}
                              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              {settle.isPending ? "..." : "Pay"}
                            </button>
                          </div>
                          <button
                            onClick={() => { setSettlePrompt(null); setCustomSettleAmount(""); }}
                            className="text-xs text-gray-400 hover:text-gray-600 px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setSettlePrompt({ to: d.to, amount: d.amount })}
                          className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                        >
                          Settle up
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Manual settle */}
          <div className="border rounded p-3 bg-gray-50">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Record a payment</h3>
            <div className="flex gap-2 flex-col sm:flex-row">
              <select
                value={settleDirection}
                onChange={(e) => setSettleDirection(e.target.value as "paid" | "received")}
                className="w-full sm:w-32 border rounded px-2 py-1 text-sm bg-white"
              >
                <option value="paid">You paid</option>
                <option value="received">You received from</option>
              </select>
              <select
                value={settleOtherId}
                onChange={(e) => setSettleOtherId(Number(e.target.value))}
                className="min-w-0 flex-1 border rounded px-2 py-1 text-sm bg-white"
              >
                <option value={0}>Select member...</option>
                {members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Amount"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                className="w-full min-w-0 border rounded px-2 py-1 text-sm sm:w-28"
              />
              <button
                disabled={settle.isPending}
                onClick={() => {
                  if (settleOtherId && settleAmount) {
                    const amt = parseFloat(settleAmount);
                    if (amt > 0) {
                      const paidBy = settleDirection === "paid" ? user!.id : settleOtherId;
                      const paidTo = settleDirection === "paid" ? settleOtherId : user!.id;
                      settle.mutate({ paidBy, paidTo, amount: amt });
                    }
                  }
                }}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {settle.isPending ? "Recording..." : "Record"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Activity */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Activity History</h2>
        {activity.length === 0 ? (
          <p className="text-gray-400 text-sm">No activity yet.</p>
        ) : (
          <ul className="space-y-1">
            {activity.map((item) => (
              <li key={item.id} className="break-words text-sm border rounded p-2 text-gray-600">
                <span className="font-medium">{item.user_id === user?.id ? "You" : item.user_name}</span>
                {" "}
                <span>{activityText(item.summary, item.user_name)}</span>
                <span className="text-gray-400 ml-2">{formatDate(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Members */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Members ({members.length})
        </h2>

        <form onSubmit={handleAddMember} className="flex flex-col gap-2 mb-4 sm:flex-row">
          <input
            type="email"
            placeholder="Add member by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-0 flex-1 border rounded px-3 py-2"
            required
          />
          <button
            type="submit"
            disabled={add.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {add.isPending ? "Adding..." : "Add"}
          </button>
        </form>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-start justify-between gap-3 border rounded p-3"
            >
              <div className="min-w-0">
                <span className="font-medium break-words">{m.user_id === user?.id ? "You" : m.name}</span>
                <span className="block break-all text-gray-400 text-sm sm:ml-2 sm:inline">{m.email}</span>
                {m.role === "admin" && (
                  <span className="mt-1 inline-block text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 sm:ml-2 sm:mt-0">
                    admin
                  </span>
                )}
              </div>
              {isAdmin && m.user_id !== user?.id && (
                <button
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.user_id)}
                  className="shrink-0 text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
