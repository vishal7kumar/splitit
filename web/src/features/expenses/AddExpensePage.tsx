import { useState, FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getGroup, type GroupMember } from "../../api/groups";
import { createExpense, type SplitEntry } from "../../api/expenses";
import { useAuth } from "../auth/useAuth";

export default function AddExpensePage() {
  const { id } = useParams<{ id: string }>();
  const groupId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [paidBy, setPaidBy] = useState<number>(0);
  const [splitType, setSplitType] = useState<"equal" | "exact" | "percentage">(
    "equal"
  );
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [exactAmounts, setExactAmounts] = useState<Record<number, string>>({});
  const [percentages, setPercentages] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
    onSuccess: (d: { members: GroupMember[] }) => {
      if (paidBy === 0 && user) setPaidBy(user.id);
      if (selectedMembers.length === 0) {
        setSelectedMembers(d.members.map((m: GroupMember) => m.user_id));
      }
    },
  } as Parameters<typeof useQuery>[0]);

  const create = useMutation({
    mutationFn: (splits: SplitEntry[]) =>
      createExpense(groupId, {
        amount: parseFloat(amount),
        description,
        category,
        date,
        paid_by: paidBy,
        split_type: splitType,
        splits,
      }),
    onSuccess: () => navigate(`/groups/${groupId}`),
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
    } else {
      splits = selectedMembers.map((uid) => ({
        user_id: uid,
        percentage: parseFloat(percentages[uid] || "0"),
      }));
    }

    create.mutate(splits);
  }

  function toggleMember(uid: number) {
    setSelectedMembers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  if (isLoading || !data) return <p className="text-gray-500">Loading...</p>;
  const { members } = data;

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Add Expense</h1>
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
            {members.map((m) => (
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
            {(["equal", "exact", "percentage"] as const).map((t) => (
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
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">
            Split among
          </label>
          <div className="space-y-2 mt-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(m.user_id)}
                  onChange={() => toggleMember(m.user_id)}
                />
                <span className="flex-1">{m.name}</span>
                {splitType === "exact" && selectedMembers.includes(m.user_id) && (
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={exactAmounts[m.user_id] || ""}
                    onChange={(e) =>
                      setExactAmounts((p) => ({
                        ...p,
                        [m.user_id]: e.target.value,
                      }))
                    }
                    className="w-24 border rounded px-2 py-1 text-sm"
                  />
                )}
                {splitType === "percentage" &&
                  selectedMembers.includes(m.user_id) && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="%"
                        value={percentages[m.user_id] || ""}
                        onChange={(e) =>
                          setPercentages((p) => ({
                            ...p,
                            [m.user_id]: e.target.value,
                          }))
                        }
                        className="w-20 border rounded px-2 py-1 text-sm"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Add Expense
        </button>
      </form>
    </div>
  );
}
