import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listFriends, settleFriend } from "../../api/friends";
import { getTotalBalance } from "../../api/settlements";
import { formatCurrency } from "../../lib/currency";

export default function FriendsPage() {
  const queryClient = useQueryClient();
  const [openFriendId, setOpenFriendId] = useState<number | null>(null);

  const { data: totalBalanceData } = useQuery({
    queryKey: ["total-balance"],
    queryFn: getTotalBalance,
  });

  const { data: friends = [], isLoading } = useQuery({
    queryKey: ["friends"],
    queryFn: listFriends,
  });

  const settle = useMutation({
    mutationFn: (friendId: number) => settleFriend(friendId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
    },
  });

  return (
    <div className="max-w-2xl mx-auto px-1 sm:px-0">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Friends</h1>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">Loading friends...</p>
        </div>
      ) : friends.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center shadow-sm">
          <p className="text-gray-500 text-sm mb-1">No friends yet.</p>
          <p className="text-gray-400 text-xs">Add members to your groups and they will appear here as friends.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {friends.map((friend) => {
            const isOpen = openFriendId === friend.user_id;
            const hasBalance = Math.abs(friend.total_balance) > 0.01;
            const defaultCurrency = totalBalanceData?.groups[0]?.currency || "INR";
            const currency = friend.groups[0]?.currency || defaultCurrency;

            return (
              <li
                key={friend.user_id}
                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm transition-all duration-200"
              >
                <button
                  type="button"
                  onClick={() => setOpenFriendId(isOpen ? null : friend.user_id)}
                  className="flex w-full items-center justify-between p-4 text-left hover:bg-gray-50 focus:outline-none transition-all cursor-pointer"
                >
                  <div className="min-w-0 mr-3">
                    <span className="block font-semibold text-gray-900 truncate">
                      {friend.name || friend.email}
                    </span>
                    <span className="block text-xs text-gray-400 truncate">
                      {friend.email}
                    </span>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-3">
                    <span
                      className={`font-bold text-sm ${
                        friend.total_balance > 0.005
                          ? "text-green-600"
                          : friend.total_balance < -0.005
                            ? "text-red-600"
                            : "text-gray-500"
                      }`}
                    >
                      {friend.total_balance > 0.005 ? "+" : ""}
                      {formatCurrency(currency, friend.total_balance)}
                    </span>
                    <svg
                      className={`w-4 h-4 text-gray-400 transform transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4 animate-slide-down">
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">
                      Group breakdown
                    </p>
                    {friend.groups.length === 0 ? (
                      <p className="text-xs text-gray-500 italic">All settled up in all shared groups.</p>
                    ) : (
                      <ul className="space-y-2 mb-4">
                        {friend.groups.map((group) => (
                          <li
                            key={group.group_id}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <Link
                              to={`/groups/${group.group_id}`}
                              className="min-w-0 truncate text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                            >
                              {group.name}
                            </Link>
                            <span
                              className={`shrink-0 font-bold ${
                                group.balance > 0.005 ? "text-green-600" : group.balance < -0.005 ? "text-red-600" : "text-gray-500"
                              }`}
                            >
                              {group.balance > 0.005 ? "+" : ""}
                              {formatCurrency(group.currency, group.balance)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {hasBalance && (
                      <button
                        type="button"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate(friend.user_id)}
                        className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-all cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {settle.isPending ? "Settling up..." : "Settle up"}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
