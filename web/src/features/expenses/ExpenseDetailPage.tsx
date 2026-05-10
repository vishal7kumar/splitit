import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getGroup, type GroupMember } from "../../api/groups";
import {
  addExpenseComment,
  deleteExpense,
  getExpense,
  type ExpenseSplit,
} from "../../api/expenses";
import { formatDate } from "../../lib/formatDate";
import { useAuth } from "../auth/useAuth";
import { formatCurrency } from "../../lib/currency";

export default function ExpenseDetailPage() {
  const { id, eid } = useParams<{ id: string; eid: string }>();
  const groupId = Number(id);
  const expenseId = Number(eid);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const { data: groupData, isLoading: groupLoading } = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });

  const { data: expenseData, isLoading: expenseLoading } = useQuery({
    queryKey: ["expense", groupId, expenseId],
    queryFn: () => getExpense(groupId, expenseId),
  });

  const addComment = useMutation({
    mutationFn: (body: string) => addExpenseComment(groupId, expenseId, body),
    onSuccess: () => {
      setComment("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["expense", groupId, expenseId] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) =>
      setError(err.response?.data?.error || "Failed to add comment"),
  });

  const delExpense = useMutation({
    mutationFn: () => deleteExpense(groupId, expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      navigate(`/groups/${groupId}`);
    },
  });

  function handleComment(e: FormEvent) {
    e.preventDefault();
    const body = comment.trim();
    if (!body) {
      setError("Comment cannot be empty");
      return;
    }
    addComment.mutate(body);
  }

  if (groupLoading || expenseLoading || !groupData || !expenseData) {
    return <p className="text-gray-500">Loading...</p>;
  }

  const { group, members } = groupData;
  const { expense, splits, comments = [], history = [] } = expenseData;
  const memberMap = Object.fromEntries(
    members.map((m: GroupMember) => [m.user_id, m])
  );
  const payerName = expense.paid_by === user?.id ? "You" : (memberMap[expense.paid_by]?.name || "Unknown");

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          to={`/groups/${groupId}`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Back to {group.name}
        </Link>
        <div className="flex items-start justify-between gap-3 mt-3">
          <div>
            <h1 className="text-2xl font-bold">
              {expense.description || "Untitled expense"}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
              <span>{expense.category}</span>
              <span>&middot;</span>
              <span>{formatCurrency(group.currency, expense.amount)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to={`/groups/${groupId}/expenses/${expenseId}/edit`}
              className="text-sm bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
            >
              Edit
            </Link>
            <button
              type="button"
              disabled={delExpense.isPending}
              onClick={() => {
                if (confirm("Delete this expense?")) delExpense.mutate();
              }}
              className="text-sm border border-red-200 text-red-600 px-3 py-2 rounded hover:bg-red-50 disabled:opacity-50"
            >
              {delExpense.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>

      <section className="mb-8 border rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Paid by</dt>
            <dd className="font-medium">{payerName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Expense date</dt>
            <dd className="font-medium">{formatDate(expense.date)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Added on</dt>
            <dd className="font-medium">{formatDate(expense.created_at)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Updated on</dt>
            <dd className="font-medium">{formatDate(expense.updated_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Who owes</h2>
        <ul className="space-y-2">
          {splits.map((split: ExpenseSplit) => (
            <li
              key={split.id}
              className="flex items-center justify-between border rounded p-3 text-sm"
            >
              <span>{split.user_id === user?.id ? "You" : (memberMap[split.user_id]?.name || "Unknown")}</span>
              <span className="font-medium">
                {formatCurrency(group.currency, split.share_amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Transaction history</h2>
        {history.length === 0 ? (
          <p className="text-gray-400 text-sm">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="border rounded p-3 text-sm">
                <div className="font-medium">{entry.summary}</div>
                <div className="text-gray-500 mt-1">
                  {entry.user_name} &middot; {formatDate(entry.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Comments</h2>
        <form onSubmit={handleComment} className="mb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full border rounded px-3 py-2 text-sm min-h-24"
          />
          {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
          <button
            type="submit"
            disabled={addComment.isPending}
            className="mt-2 bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {addComment.isPending ? "Adding..." : "Add comment"}
          </button>
        </form>

        {comments.length === 0 ? (
          <p className="text-gray-400 text-sm">No comments yet.</p>
        ) : (
          <ul className="space-y-2">
            {comments.map((item) => (
              <li key={item.id} className="border rounded p-3 text-sm">
                <div className="flex justify-between gap-3 text-gray-500 mb-1">
                  <span className="font-medium text-gray-700">{item.user_name}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
