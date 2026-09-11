import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGroup, type GroupMember } from "../../api/groups";
import { createExpense, type SplitEntry } from "../../api/expenses";
import { useAuth } from "../auth/useAuth";
import { currencySymbols } from "../../lib/currency";

type SplitType = "equal" | "exact" | "percentage" | "shares";

const splitTypeLabels: Record<SplitType, string> = {
  equal: "Equally",
  exact: "Unequally",
  percentage: "Percentage",
  shares: "Shares",
};

export default function AddExpensePage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidBy, setPaidBy] = useState<number>(0);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [exactAmounts, setExactAmounts] = useState<Record<number, string>>({});
  const [percentages, setPercentages] = useState<Record<number, string>>({});
  const [shares, setShares] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [membersInitialized, setMembersInitialized] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  useEffect(() => {
    if (user && paidBy === 0) {
      setPaidBy(user.id);
    }
  }, [paidBy, user]);

  useEffect(() => {
    if (data && !membersInitialized) {
      setSelectedMembers(data.members.map((m: GroupMember) => m.user_id));
      setMembersInitialized(true);
    }
  }, [data, membersInitialized]);

  const create = useMutation({
    mutationFn: (splits: SplitEntry[]) =>
      createExpense(groupId, {
        amount: parseFloat(amount),
        description,
        date,
        paid_by: paidBy,
        split_type: splitType,
        splits,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      navigate(`/groups/${groupId}`);
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) =>
      setError(err.response?.data?.error || "Failed to create expense"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!amount || parseFloat(amount) <= 0) {
      setError("Amount must be positive");
      return;
    }
    if (selectedMembers.length === 0) {
      setError("Select at least one member");
      return;
    }

    let splits: SplitEntry[];
    if (splitType === "equal") {
      splits = selectedMembers.map((uid) => ({ user_id: uid }));
    } else if (splitType === "exact") {
      splits = selectedMembers.map((uid) => ({
        user_id: uid,
        share_amount: parseFloat(exactAmounts[uid] || "0"),
      }));
    } else if (splitType === "percentage") {
      splits = selectedMembers.map((uid) => ({
        user_id: uid,
        percentage: parseFloat(percentages[uid] || "0"),
      }));
    } else {
      splits = selectedMembers.map((uid) => ({
        user_id: uid,
        shares: parseFloat(shares[uid] || "0"),
      }));
    }

    create.mutate(splits);
  }

  function toggleMember(uid: number) {
    setSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  function toggleAllMembers() {
    if (!data) return;
    const memberIds = data.members.map((m: GroupMember) => m.user_id);
    setSelectedMembers((prev) =>
      prev.length === memberIds.length ? [] : memberIds
    );
  }

  if (isLoading || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading expense form...</p>
      </div>
    );
  }

  const { members, group } = data;
  const currencySymbol = currencySymbols[group.currency] || "₹";

  return (
    <div className="max-w-lg mx-auto px-1 sm:px-0">
      {/* Back to Group Link */}
      <div className="mb-4">
        <Link
          to={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors font-medium cursor-pointer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
            />
          </svg>
          Back to {group.name}
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Add Expense</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Split a new expense with members of {group.name}.</p>
        </div>
        <button
          type="submit"
          form="add-expense-form"
          disabled={create.isPending}
          className="sm:hidden flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-full p-2.5 disabled:opacity-50 transition-colors shadow-sm cursor-pointer"
          aria-label="Save expense"
        >
          {create.isPending ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={3}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>
      </div>

      <form
        id="add-expense-form"
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 sm:p-6 shadow-sm space-y-5"
      >
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-rose-400 px-3.5 py-2.5 rounded-lg text-xs font-medium">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Amount</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400 dark:text-gray-500 font-semibold text-sm select-none">
              {currencySymbol}
            </span>
            <input
              type="number"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full pl-8 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-all duration-200 shadow-xs"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Description</label>
          <input
            type="text"
            placeholder="e.g. Dinner, Groceries, Flight tickets"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-all duration-200 shadow-xs"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              max={new Date().toISOString().split("T")[0]}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-all duration-200 cursor-pointer shadow-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Paid by</label>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(Number(e.target.value))}
              className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-all duration-200 cursor-pointer shadow-xs"
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === user?.id ? "You" : m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Split type</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["equal", "exact", "percentage", "shares"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSplitType(t)}
                className={`py-2 px-3 rounded-lg text-xs font-semibold text-center transition-all duration-200 cursor-pointer ${
                  splitType === t
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {splitTypeLabels[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400">Split among</label>
            <button
              type="button"
              onClick={toggleAllMembers}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
            >
              {selectedMembers.length === members.length ? "Unselect all" : "Select all"}
            </button>
          </div>
          
          <div className="space-y-2">
            {members.map((m) => {
              const isSelected = selectedMembers.includes(m.user_id);
              return (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                    isSelected
                      ? "bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 shadow-2xs"
                      : "bg-gray-50/50 dark:bg-gray-900/40 border-gray-100 dark:border-gray-800/60 text-gray-400 dark:text-gray-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleMember(m.user_id)}
                    className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded focus:ring-blue-500 transition-all cursor-pointer"
                  />
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold select-none shrink-0 ${
                        isSelected ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300" : "bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {m.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <span className={`break-words text-sm font-medium ${isSelected ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-500"}`}>
                      {m.user_id === user?.id ? "You" : m.name}
                    </span>
                  </div>
                  
                  {splitType === "exact" && isSelected && (
                    <div className="flex w-28 items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all shadow-xs">
                      <span className="pl-2.5 text-gray-400 dark:text-gray-500 font-semibold select-none text-xs">
                        {currencySymbol}
                      </span>
                      <input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={exactAmounts[m.user_id] || ""}
                        onChange={(e) =>
                          setExactAmounts((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 px-2 py-1 outline-none text-right text-sm rounded-r-lg bg-transparent text-gray-900 dark:text-white"
                      />
                    </div>
                  )}
                  {splitType === "percentage" && isSelected && (
                    <div className="flex w-24 items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all shadow-xs">
                      <input
                        type="number"
                        step="any"
                        placeholder="0"
                        value={percentages[m.user_id] || ""}
                        onChange={(e) =>
                          setPercentages((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 px-2.5 py-1 outline-none text-right text-sm rounded-l-lg bg-transparent text-gray-900 dark:text-white"
                      />
                      <span className="pr-2.5 text-gray-400 dark:text-gray-500 font-semibold select-none text-xs">%</span>
                    </div>
                  )}
                  {splitType === "shares" && isSelected && (
                    <div className="flex w-32 items-center rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all shadow-xs">
                      <input
                        type="number"
                        step="any"
                        placeholder="1"
                        value={shares[m.user_id] || ""}
                        onChange={(e) =>
                          setShares((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 px-2.5 py-1 outline-none text-right text-sm rounded-l-lg bg-transparent text-gray-900 dark:text-white"
                      />
                      <span className="pr-2.5 text-gray-400 dark:text-gray-500 font-semibold select-none text-xs">shares</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden sm:flex flex-col gap-3 sm:flex-row border-t border-gray-100 dark:border-gray-800 pt-5">
          <button
            type="submit"
            disabled={create.isPending}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all duration-200 cursor-pointer shadow-sm font-semibold text-sm"
          >
            {create.isPending ? "Adding..." : "Add Expense"}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="flex-1 border border-gray-300 dark:border-gray-700 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-all duration-200 cursor-pointer text-gray-700 dark:text-gray-200 font-medium text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
