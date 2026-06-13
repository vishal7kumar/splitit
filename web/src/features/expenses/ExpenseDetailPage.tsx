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
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <div className="mb-6">
        <Link
          to={`/groups/${groupId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors font-medium cursor-pointer"
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
        
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mt-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-gray-900">
              {expense.description || "Untitled expense"}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-gray-500">
              <span className="inline-block text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-medium uppercase tracking-wider">
                {expense.category}
              </span>
              <span>&middot;</span>
              <span className="font-semibold text-gray-800">
                {formatCurrency(group.currency, expense.amount)}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to={`/groups/${groupId}/expenses/${expenseId}/edit`}
              className="text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-semibold shadow-sm transition-all duration-200 cursor-pointer"
            >
              Edit
            </Link>
            <button
              type="button"
              disabled={delExpense.isPending}
              onClick={() => {
                if (confirm("Delete this expense?")) delExpense.mutate();
              }}
              className="text-xs sm:text-sm border border-red-200 text-red-600 hover:border-red-300 px-3 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-all duration-200 cursor-pointer"
            >
              {delExpense.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>

      <section className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">Details</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Paid by</dt>
            <dd className="font-medium text-sm text-gray-800 mt-0.5">{payerName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Expense date</dt>
            <dd className="font-medium text-sm text-gray-800 mt-0.5">{formatDate(expense.date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Added on</dt>
            <dd className="font-medium text-sm text-gray-800 mt-0.5">{formatDate(expense.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Updated on</dt>
            <dd className="font-medium text-sm text-gray-800 mt-0.5">{formatDate(expense.updated_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-2 mb-2">Who owes</h2>
        <ul className="divide-y divide-gray-100">
          {splits.map((split: ExpenseSplit) => (
            <li
              key={split.id}
              className="flex items-center justify-between py-3 text-sm text-gray-700"
            >
              <span className="font-medium">{split.user_id === user?.id ? "You" : (memberMap[split.user_id]?.name || "Unknown")}</span>
              <span className="font-bold text-gray-900">
                {formatCurrency(group.currency, split.share_amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-2 mb-2">Transaction history</h2>
        {history.length === 0 ? (
          <p className="text-gray-400 text-xs italic py-3">No history yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((entry) => (
              <li key={entry.id} className="py-3 text-sm">
                <div className="font-medium text-gray-800">{entry.summary}</div>
                <div className="text-gray-400 text-xs mt-0.5 font-medium">
                  {entry.user_name} &middot; {formatDate(entry.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-2 mb-4">Comments</h2>
        
        <form onSubmit={handleComment} className="mb-4">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white transition-all duration-200 min-h-24"
          />
          {error && <p className="text-red-600 text-xs font-semibold mt-1">{error}</p>}
          <button
            type="submit"
            disabled={addComment.isPending}
            className="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-60 transition-all duration-200 cursor-pointer shadow-sm"
          >
            {addComment.isPending ? "Adding..." : "Add comment"}
          </button>
        </form>

        {comments.length === 0 ? (
          <p className="text-gray-400 text-xs italic py-2">No comments yet.</p>
        ) : (
          <ul className="space-y-3 mt-4 border-t border-gray-100 pt-4">
            {comments.map((item) => (
              <li key={item.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 text-sm shadow-2xs space-y-1">
                <div className="flex justify-between gap-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  <span className="text-gray-600">{item.user_name}</span>
                  <span>{formatDate(item.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-gray-700 leading-relaxed text-sm mt-1">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
