import { useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
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

  if (isLoading || !data) return <p className="text-gray-500">Loading...</p>;
  const { members } = data;
  const currencySymbol = currencySymbols[data.group.currency] || "₹";

  return (
    <div className="max-w-lg mx-auto px-1 sm:px-0">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="inline-flex items-center justify-center p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all cursor-pointer"
            aria-label="Back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Add Expense</h1>
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
        className="bg-white border border-gray-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-5"
      >
        {error && <p className="text-red-600 text-xs font-semibold">{error}</p>}

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Amount</label>
          <input
            type="number"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Description</label>
          <input
            type="text"
            placeholder="e.g. Dinner, Groceries"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Date</label>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Paid by</label>
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 cursor-pointer"
          >
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user_id === user?.id ? "You" : m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Split type</label>
          <div className="flex flex-wrap gap-2">
            {(["equal", "exact", "percentage", "shares"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSplitType(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  splitType === t
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {splitTypeLabels[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-xs font-semibold text-gray-500">Split among</label>
            <button
              type="button"
              onClick={toggleAllMembers}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
            >
              {selectedMembers.length === members.length ? "Unselect all" : "Select all"}
            </button>
          </div>
          
          <div className="space-y-1">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50/50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(m.user_id)}
                  onChange={() => toggleMember(m.user_id)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 transition-all cursor-pointer"
                />
                <span className="min-w-0 flex-1 break-words text-sm text-gray-700 font-medium">
                  {m.user_id === user?.id ? "You" : m.name}
                </span>
                
                {splitType === "exact" && selectedMembers.includes(m.user_id) && (
                  <div className="flex w-28 items-center rounded-lg border border-gray-300 bg-white text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
                    <span className="pl-2.5 text-gray-400 font-semibold select-none">
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
                      className="min-w-0 flex-1 px-2 py-1 outline-none text-right text-sm rounded-r-lg"
                    />
                  </div>
                )}
                {splitType === "percentage" && selectedMembers.includes(m.user_id) && (
                  <div className="flex w-24 items-center rounded-lg border border-gray-300 bg-white text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
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
                      className="min-w-0 flex-1 px-2.5 py-1 outline-none text-right text-sm rounded-l-lg"
                    />
                    <span className="pr-2.5 text-gray-400 font-semibold select-none">%</span>
                  </div>
                )}
                {splitType === "shares" && selectedMembers.includes(m.user_id) && (
                  <div className="flex w-32 items-center rounded-lg border border-gray-300 bg-white text-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
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
                      className="min-w-0 flex-1 px-2.5 py-1 outline-none text-right text-sm rounded-l-lg"
                    />
                    <span className="pr-2.5 text-gray-400 font-semibold select-none text-xs">shares</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="hidden sm:flex flex-col gap-2 sm:flex-row border-t border-gray-100 pt-4">
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
            className="flex-1 border border-gray-300 py-2.5 rounded-lg hover:bg-gray-50 transition-all duration-200 cursor-pointer text-gray-700 font-medium text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
