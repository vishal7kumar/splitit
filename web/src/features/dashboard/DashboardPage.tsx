import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/useAuth";
import { getTotalBalance } from "../../api/settlements";
import { listFriends, settleFriend } from "../../api/friends";
import { listUserActivity } from "../../api/activity";
import { formatCurrency } from "../../lib/currency";
import { formatDate } from "../../lib/formatDate";

export default function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [openFriendId, setOpenFriendId] = useState<number | null>(null);
  const activityLoadMoreRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ["total-balance"],
    queryFn: getTotalBalance,
  });

  const { data: friends = [] } = useQuery({
    queryKey: ["friends"],
    queryFn: listFriends,
  });

  const {
    data: activityPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["user-activity"],
    queryFn: ({ pageParam }) => listUserActivity({ limit: 20, cursor: pageParam }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
  });

  useEffect(() => {
    const node = activityLoadMoreRef.current;
    if (!node || !hasNextPage) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "160px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const settle = useMutation({
    mutationFn: (friendId: number) => settleFriend(friendId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      queryClient.invalidateQueries({ queryKey: ["total-balance"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["user-activity"] });
    },
  });

  const activity = activityPages?.pages.flatMap((page) => page.items) || [];
  const activityText = (summary: string, actorName: string) =>
    summary.startsWith(actorName) ? summary.slice(actorName.length).trim() : summary;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-gray-600 mb-6">
        Welcome back, {user?.name || user?.email}!
      </p>

      {data && (
        <>
          <div className="border rounded p-4 mb-6">
            <p className="text-sm text-gray-500">Overall balance</p>
            <p
              className={`text-3xl font-bold ${
                data.total_balance >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {data.total_balance >= 0 ? "+" : ""}
              {formatCurrency(data.groups[0]?.currency || "INR", data.total_balance)}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {data.total_balance > 0
                ? "Others owe you overall"
                : data.total_balance < 0
                  ? "You owe others overall"
                  : "All settled up!"}
            </p>
          </div>

          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Friends</h2>
            {friends.length === 0 ? (
              <p className="text-gray-400 text-sm border rounded p-3">
                No shared group members yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {friends.map((friend) => {
                  const isOpen = openFriendId === friend.user_id;
                  const hasBalance = Math.abs(friend.total_balance) > 0.01;
                  const currency = friend.groups[0]?.currency || data.groups[0]?.currency || "INR";

                  return (
                    <li key={friend.user_id} className="border rounded">
                      <button
                        type="button"
                        onClick={() => setOpenFriendId(isOpen ? null : friend.user_id)}
                        className="flex w-full flex-col gap-2 p-3 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium break-words">
                            {friend.name || friend.email}
                          </span>
                          <span className="block text-sm text-gray-400 break-all">
                            {friend.email}
                          </span>
                        </span>
                        <span
                          className={`font-medium ${
                            friend.total_balance >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {friend.total_balance > 0 ? "+" : ""}
                          {formatCurrency(currency, friend.total_balance)}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t bg-gray-50 p-3">
                          {friend.groups.length === 0 ? (
                            <p className="text-sm text-gray-500">All settled up.</p>
                          ) : (
                            <ul className="space-y-1">
                              {friend.groups.map((group) => (
                                <li
                                  key={group.group_id}
                                  className="flex items-center justify-between gap-3 text-sm"
                                >
                                  <Link
                                    to={`/groups/${group.group_id}`}
                                    className="min-w-0 break-words text-blue-600 hover:text-blue-800"
                                  >
                                    {group.name}
                                  </Link>
                                  <span
                                    className={`shrink-0 font-medium ${
                                      group.balance >= 0 ? "text-green-600" : "text-red-600"
                                    }`}
                                  >
                                    {group.balance > 0 ? "+" : ""}
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
                              className="mt-3 bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                            >
                              {settle.isPending ? "Settling..." : "Settle up"}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {data.groups.length > 0 && (
            <section className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Per group</h2>
              <ul className="space-y-2">
                {data.groups.map((g) => (
                  <li key={g.group_id}>
                    <Link
                      to={`/groups/${g.group_id}`}
                      className="flex items-center justify-between border rounded p-3 hover:bg-gray-50"
                    >
                      <div>
                        <span className="font-medium">{g.name}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 ml-2">
                          {g.currency}
                        </span>
                      </div>
                      <span
                        className={`font-medium ${
                          g.balance >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {g.balance > 0 ? "+" : ""}
                        {formatCurrency(g.currency, g.balance)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="text-gray-400 text-sm border rounded p-3">
                No activity yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {activity.map((item) => {
                  const content = (
                    <div className="break-words text-sm text-gray-600">
                      {!item.is_involved && (
                        <span className="mb-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          You were not involved
                        </span>
                      )}
                      <div>
                        <span className="font-medium">
                          {item.user_id === user?.id ? "You" : item.user_name}
                        </span>{" "}
                        <span>{activityText(item.summary, item.user_name)}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {item.group_name || "Group"} &middot; {formatDate(item.created_at)}
                      </div>
                    </div>
                  );

                  return (
                    <li key={item.id}>
                      {item.expense_id ? (
                        <Link
                          to={`/groups/${item.group_id}/expenses/${item.expense_id}`}
                          className="block border rounded p-3 hover:bg-gray-50"
                        >
                          {content}
                        </Link>
                      ) : (
                        <Link
                          to={`/groups/${item.group_id}`}
                          className="block border rounded p-3 hover:bg-gray-50"
                        >
                          {content}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div ref={activityLoadMoreRef} className="h-6" />
            {isFetchingNextPage && (
              <p className="text-center text-xs text-gray-400">Loading more...</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
