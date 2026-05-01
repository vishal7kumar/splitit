import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGroup, type GroupMember } from "../../api/groups";
import {
  getExpense,
  updateExpense,
  type SplitEntry,
  type ExpenseSplit,
} from "../../api/expenses";

type SplitType = "equal" | "exact" | "percentage" | "shares";

const splitTypeLabels: Record<SplitType, string> = {
  equal: "Equally",
  exact: "Unequally",
  percentage: "Percentage",
  shares: "Shares",
};

const currencySymbols: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export default function EditExpensePage() {
  const { id, eid } = useParams<{ id: string; eid: string }>();
  const groupId = Number(id);
  const expenseId = Number(eid);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [date, setDate] = useState("");
  const [paidBy, setPaidBy] = useState<number>(0);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [exactAmounts, setExactAmounts] = useState<Record<number, string>>({});
  const [percentages, setPercentages] = useState<Record<number, string>>({});
  const [shares, setShares] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const { data: groupData } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenseData } = useQuery({
    queryKey: ["expense", groupId, expenseId],
    queryFn: () => getExpense(groupId, expenseId),
  });

  useEffect(() => {
    if (expenseData && groupData && !loaded) {
      const exp = expenseData.expense;
      const splits = expenseData.splits;
      setAmount(String(exp.amount));
      setDescription(exp.description);
      setCategory(exp.category);
      setDate(exp.date);
      setPaidBy(exp.paid_by);
      setSelectedMembers(splits.map((s: ExpenseSplit) => s.user_id));

      // Determine split type: if all shares are equal, it's "equal"
      const allEqual = splits.every(
        (s: ExpenseSplit) =>
          Math.abs(s.share_amount - splits[0].share_amount) < 0.01
      );
      if (allEqual) {
        setSplitType("equal");
      } else {
        setSplitType("exact");
        const amounts: Record<number, string> = {};
        splits.forEach(
          (s: ExpenseSplit) => (amounts[s.user_id] = String(s.share_amount))
        );
        setExactAmounts(amounts);
      }
      setLoaded(true);
    }
  }, [expenseData, groupData, loaded]);

  const update = useMutation({
    mutationFn: (splits: SplitEntry[]) =>
      updateExpense(groupId, expenseId, {
        amount: parseFloat(amount),
        description,
        category,
        date,
        paid_by: paidBy,
        split_type: splitType,
        splits,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      navigate(`/groups/${groupId}`);
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) =>
      setError(err.response?.data?.error || "Failed to update expense"),
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

    update.mutate(splits);
  }

  function toggleMember(uid: number) {
    setSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  function toggleAllMembers() {
    if (!groupData) return;
    const memberIds = groupData.members.map((m: GroupMember) => m.user_id);
    setSelectedMembers((prev) =>
      prev.length === memberIds.length ? [] : memberIds
    );
  }

  if (!groupData || !expenseData)
    return <p className="text-gray-500">Loading...</p>;

  const { members } = groupData;
  const currencySymbol = currencySymbols[groupData.group.currency] || "₹";

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Edit Expense</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-red-600 text-sm">{error}</p>}

        <input
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex-1 border rounded px-3 py-2"
          />
          <input
            type="date"
            value={date}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Paid by</label>
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(Number(e.target.value))}
            className="w-full border rounded px-3 py-2 mt-1"
          >
            {members.map((m: GroupMember) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">
            Split type
          </label>
          <div className="flex gap-2 mt-1">
            {(["equal", "exact", "percentage", "shares"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSplitType(t)}
                className={`px-3 py-1 rounded text-sm ${
                  splitType === t
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {splitTypeLabels[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Split among
            </label>
            <button
              type="button"
              onClick={toggleAllMembers}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              {selectedMembers.length === members.length
                ? "Unselect all"
                : "Select all"}
            </button>
          </div>
          <div className="space-y-2 mt-1">
            {members.map((m: GroupMember) => (
              <div key={m.user_id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(m.user_id)}
                  onChange={() => toggleMember(m.user_id)}
                />
                <span className="flex-1">{m.name}</span>
                {splitType === "exact" && selectedMembers.includes(m.user_id) && (
                  <div className="flex w-28 items-center rounded border bg-white text-sm">
                    <span className="pl-2 text-gray-500">
                      {currencySymbol}
                    </span>
                    <input
                      type="number"
                      step="1"
                      placeholder="Amount"
                      value={exactAmounts[m.user_id] || ""}
                      onChange={(e) =>
                        setExactAmounts((p) => ({
                          ...p,
                          [m.user_id]: e.target.value,
                        }))
                      }
                      className="min-w-0 flex-1 px-1 py-1 outline-none"
                    />
                  </div>
                )}
                {splitType === "percentage" &&
                  selectedMembers.includes(m.user_id) && (
                    <div className="flex w-24 items-center rounded border bg-white text-sm">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="0"
                        value={percentages[m.user_id] || ""}
                        onChange={(e) =>
                          setPercentages((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 px-2 py-1 outline-none"
                      />
                      <span className="pr-2 text-gray-500">%</span>
                    </div>
                  )}
                {splitType === "shares" &&
                  selectedMembers.includes(m.user_id) && (
                    <div className="flex w-32 items-center rounded border bg-white text-sm">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="1"
                        value={shares[m.user_id] || ""}
                        onChange={(e) =>
                          setShares((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 px-2 py-1 outline-none"
                      />
                      <span className="pr-2 text-gray-500">share(s)</span>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Save Changes
          </button>
          <button
            type="button"
            onClick={() => navigate(`/groups/${groupId}`)}
            className="flex-1 border py-2 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
