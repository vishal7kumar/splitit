import { useState, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGroup, addMember, removeMember, deleteGroup, updateGroup } from "../../api/groups";
import { listExpenses, deleteExpense, type Expense } from "../../api/expenses";
import {
  getGroupBalances,
  createSettlement,
  listSettlements,
} from "../../api/settlements";
import { useAuth } from "../auth/useAuth";
import { formatDate } from "../../lib/formatDate";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [settleTo, setSettleTo] = useState<number>(0);
  const [settleAmount, setSettleAmount] = useState("");
  const [settlePrompt, setSettlePrompt] = useState<{ to: number; amount: number } | null>(null);
  const [customSettleAmount, setCustomSettleAmount] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses", groupId, search, categoryFilter],
    queryFn: () =>
      listExpenses(groupId, {
        q: search || undefined,
        category: categoryFilter || undefined,
      }),
  });

  const { data: balanceData } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: () => getGroupBalances(groupId),
  });

  const { data: settlements = [] } = useQuery({
    queryKey: ["settlements", groupId],
    queryFn: () => listSettlements(groupId),
  });

  const settle = useMutation({
    mutationFn: ({ paidTo, amount }: { paidTo: number; amount: number }) =>
      createSettlement(groupId, paidTo, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["settlements", groupId] });
      setSettleTo(0);
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] }),
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
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
        <div className="flex gap-3 items-start">
          <Link
            to={`/groups/${groupId}/add`}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
          >
            Add Expense
          </Link>
          {isAdmin && (
            <button
              onClick={() => {
                if (confirm("Delete this group?")) del.mutate();
              }}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Delete group
            </button>
          )}
        </div>
      </div>

      {/* Expenses */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Expenses</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Search expenses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-32 border rounded px-3 py-2 text-sm"
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
                className="flex items-center justify-between border rounded p-3 cursor-pointer hover:bg-gray-50"
              >
                <div>
                  <span className="font-medium">
                    {exp.description || "Untitled"}
                  </span>
                  <span className="text-gray-400 text-sm ml-2">
                    {exp.category}
                  </span>
                  <div className="text-sm text-gray-500">
                    {memberMap[exp.paid_by]?.name || "Unknown"} paid{" "}
                    {group.currency} {exp.amount.toFixed(2)} &middot; {formatDate(exp.date)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/groups/${groupId}/expenses/${exp.id}/edit`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this expense?"))
                        delExpense.mutate(exp.id);
                    }}
                    className="text-sm text-red-500 hover:text-red-700"
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
              <li key={b.user_id} className="flex justify-between text-sm border rounded p-2">
                <span>{b.name}</span>
                <span className={b.balance >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                  {b.balance >= 0 ? "+" : ""}{group.currency} {b.balance.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>

          {balanceData.debts.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Simplified debts</h3>
              <ul className="space-y-1 mb-4">
                {balanceData.debts.map((d, i) => (
                  <li key={i} className="flex items-center justify-between text-sm border rounded p-2">
                    <span>
                      <span className="font-medium">{d.from_name}</span>
                      {" owes "}
                      <span className="font-medium">{d.to_name}</span>
                      {" "}{group.currency} {d.amount.toFixed(2)}
                    </span>
                    {d.from === user?.id && (
                      settlePrompt?.to === d.to ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              settle.mutate({ paidTo: d.to, amount: d.amount });
                              setSettlePrompt(null);
                              setCustomSettleAmount("");
                            }}
                            className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                          >
                            Full ({group.currency} {d.amount.toFixed(2)})
                          </button>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Amount"
                              value={customSettleAmount}
                              onChange={(e) => setCustomSettleAmount(e.target.value)}
                              className="w-20 border rounded px-1 py-0.5 text-xs"
                            />
                            <button
                              onClick={() => {
                                const amt = parseFloat(customSettleAmount);
                                if (amt > 0) {
                                  settle.mutate({ paidTo: d.to, amount: amt });
                                  setSettlePrompt(null);
                                  setCustomSettleAmount("");
                                }
                              }}
                              className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                            >
                              Pay
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
            <div className="flex gap-2">
              <select
                value={settleTo}
                onChange={(e) => setSettleTo(Number(e.target.value))}
                className="flex-1 border rounded px-2 py-1 text-sm"
              >
                <option value={0}>Pay to...</option>
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
                className="w-28 border rounded px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  if (settleTo && settleAmount) {
                    settle.mutate({ paidTo: settleTo, amount: parseFloat(settleAmount) });
                  }
                }}
                className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
              >
                Pay
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Settlements */}
      {settlements.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Settlement History</h2>
          <ul className="space-y-1">
            {settlements.map((s) => (
              <li key={s.id} className="text-sm border rounded p-2 text-gray-600">
                <span className="font-medium">{s.paid_by_name}</span>
                {" paid "}
                <span className="font-medium">{s.paid_to_name}</span>
                {" "}{group.currency} {s.amount.toFixed(2)}
                <span className="text-gray-400 ml-2">{formatDate(s.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Members */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">
          Members ({members.length})
        </h2>

        <form onSubmit={handleAddMember} className="flex gap-2 mb-4">
          <input
            type="email"
            placeholder="Add member by email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 border rounded px-3 py-2"
            required
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Add
          </button>
        </form>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center justify-between border rounded p-3"
            >
              <div>
                <span className="font-medium">{m.name}</span>
                <span className="text-gray-400 text-sm ml-2">{m.email}</span>
                {m.role === "admin" && (
                  <span className="text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 ml-2">
                    admin
                  </span>
                )}
              </div>
              {isAdmin && m.user_id !== user?.id && (
                <button
                  onClick={() => remove.mutate(m.user_id)}
                  className="text-sm text-red-500 hover:text-red-700"
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
