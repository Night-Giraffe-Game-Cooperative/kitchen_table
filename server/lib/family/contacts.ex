defmodule Family.Contacts do
  @moduledoc """
  Who may chat with whom, so kids only talk to people their family trusts.

  Grown-ups can chat with any grown-up. A kid can chat with the grown-ups who
  are family to them: the grown-ups in their own household, and grown-ups
  from other households an admin has added as family to it (grandparents,
  aunts and uncles). Kids in one household chat freely; kids from different
  households need a yes from a guardian in each. A chat, a group, a game or
  a call goes ahead only when everyone in it may talk to everyone else.

  A kid's guardians are the grown-ups in their own household who look after
  its kids. Admins are guardians of the kids at home, not of other
  households' kids.
  """

  import Ecto.Query
  alias Family.{Repo, Permissions, Push}
  alias Family.Accounts.{User, Bubble}
  alias Family.Contacts.{Relative, Friendship}

  def grown_up?(%User{role: role}), do: role in ~w(admin grownup)

  @doc "Whether someone is a guardian of a kid: a grown-up in the kid's household who looks after its kids."
  def guardian_of?(%User{} = actor, %User{role: "kid"} = kid) do
    actor.active and not is_nil(kid.bubble_id) and actor.bubble_id == kid.bubble_id and
      (actor.role == "admin" or (actor.role == "grownup" and Permissions.can?(actor, :manage_kids)))
  end

  def guardian_of?(_, _), do: false

  def guardians(%User{role: "kid", bubble_id: bubble_id} = kid) when not is_nil(bubble_id) do
    from(u in User, where: u.bubble_id == ^bubble_id and u.active and u.role in ~w(admin grownup))
    |> Repo.all()
    |> Enum.filter(&guardian_of?(&1, kid))
  end

  def guardians(_), do: []

  ## The checks

  @doc """
  What the checks need to know about some people: which households each
  grown-up is family to, and which of the kids are friends.
  """
  def facts(users) do
    ids = Enum.map(users, & &1.id)

    %{
      relatives: from(r in Relative, where: r.user_id in ^ids, select: {r.bubble_id, r.user_id}) |> Repo.all() |> MapSet.new(),
      friends:
        from(f in Friendship,
          where: f.kid_id in ^ids and f.friend_id in ^ids and not is_nil(f.kid_ok_by_id) and not is_nil(f.friend_ok_by_id),
          select: {f.kid_id, f.friend_id}
        )
        |> Repo.all()
        |> MapSet.new()
    }
  end

  def may_talk?(%User{} = a, %User{} = b), do: allowed?(a, b, facts([a, b]))

  defp allowed?(a, b, facts) do
    cond do
      a.id == b.id -> true
      grown_up?(a) and grown_up?(b) -> true
      grown_up?(a) -> related?(a, b, facts)
      grown_up?(b) -> related?(b, a, facts)
      same_home?(a, b) -> true
      true -> MapSet.member?(facts.friends, pair(a.id, b.id))
    end
  end

  defp related?(grown_up, kid, facts), do: same_home?(grown_up, kid) or MapSet.member?(facts.relatives, {kid.bubble_id, grown_up.id})

  defp same_home?(a, b), do: not is_nil(a.bubble_id) and a.bubble_id == b.bubble_id

  defp pair(a, b), do: {min(a, b), max(a, b)}

  @doc "Whether everyone may talk to everyone else; if not, a message saying who can't."
  def check_together(users, facts \\ nil) do
    case why_not(users, facts) do
      nil -> :ok
      message -> {:error, message}
    end
  end

  @doc "The same check for the people in a room."
  def check_room(room_id) do
    users = Repo.all(from u in User, join: m in Family.Chat.Member, on: m.user_id == u.id, where: m.room_id == ^room_id)
    check_together(users)
  end

  @doc "Why these people can't all chat together, or nil when they can."
  def why_not(users, facts \\ nil) do
    users = users |> Enum.reject(&is_nil/1) |> Enum.uniq_by(& &1.id)
    facts = facts || facts(users)

    Enum.find_value(users, fn a ->
      Enum.find_value(users, fn b -> if a.id < b.id and not allowed?(a, b, facts), do: reason(a, b) end)
    end)
  end

  defp reason(%User{role: "kid"} = a, %User{role: "kid"} = b) do
    [first, second] = Enum.sort([a.name, b.name])
    "#{first} and #{second} can chat once a guardian from each family says yes."
  end

  defp reason(%User{role: "kid"} = kid, grown_up), do: reason(grown_up, kid)

  defp reason(grown_up, kid),
    do: "#{grown_up.name} isn't family to #{kid.name}, so they can't chat. An admin can add them as family on the Family page."

  ## Family from other households

  def relative_ids(%Bubble{id: id}), do: Repo.all(from r in Relative, where: r.bubble_id == ^id, order_by: r.id, select: r.user_id)

  @doc "An admin chooses the grown-ups from other households who are family to a household's kids."
  def set_relatives(%User{} = admin, %Bubble{} = bubble, ids) when is_list(ids) do
    if Permissions.can?(admin, :manage_people) do
      wanted =
        Repo.all(
          from u in User,
            where: u.id in ^Enum.filter(ids, &is_integer/1) and u.role in ~w(admin grownup) and u.bubble_id != ^bubble.id,
            select: u.id
        )

      Repo.transaction(fn ->
        Repo.delete_all(from r in Relative, where: r.bubble_id == ^bubble.id and r.user_id not in ^wanted)
        for id <- wanted, do: Repo.insert!(%Relative{bubble_id: bubble.id, user_id: id}, on_conflict: :nothing, conflict_target: [:bubble_id, :user_id])
      end)

      changed()
      :ok
    else
      {:error, :forbidden}
    end
  end

  def set_relatives(_, _, _), do: {:error, "Choose the grown-ups who are family to them."}

  ## Friends from other households

  @doc """
  The friendships someone can see: their household's kids', and for a
  grown-up those of the kids they're family to too. Admins see every one.
  """
  def friendships_for(%User{} = viewer) do
    query = from(f in Friendship, order_by: f.id)

    if Permissions.can?(viewer, :manage_people) do
      Repo.all(query)
    else
      homes = [viewer.bubble_id | if(grown_up?(viewer), do: Repo.all(from r in Relative, where: r.user_id == ^viewer.id, select: r.bubble_id), else: [])]
      ids = [viewer.id | Repo.all(from u in User, where: u.bubble_id in ^Enum.reject(homes, &is_nil/1) and u.role == "kid", select: u.id)]
      Repo.all(from f in query, where: f.kid_id in ^ids or f.friend_id in ^ids)
    end
  end

  @doc """
  Asks for two kids from different households to be friends here. A kid can
  ask for themselves; a guardian asking for their kid says yes for their
  side at the same time.
  """
  def ask(%User{} = actor, kid_id, friend_id) when is_integer(kid_id) and is_integer(friend_id) do
    with %User{role: "kid", active: true} = a <- Repo.get(User, kid_id) || {:error, :not_found},
         %User{role: "kid", active: true} = b <- Repo.get(User, friend_id) || {:error, :not_found},
         true <- a.id != b.id || {:error, :not_found},
         true <- not same_home?(a, b) || {:error, "#{a.name} and #{b.name} are in the same family, so they can chat already."},
         true <- actor.id in [a.id, b.id] or guardian_of?(actor, a) or guardian_of?(actor, b) || {:error, :forbidden} do
      {kid, friend} = if a.id < b.id, do: {a, b}, else: {b, a}
      asked = Repo.get_by(Friendship, kid_id: kid.id, friend_id: friend.id)
      friendship = asked || Repo.insert!(%Friendship{kid_id: kid.id, friend_id: friend.id, asked_by_id: actor.id})
      {:ok, said} = say_yes(actor, friendship, kid, friend)

      # Asking again only tells the guardians again if it changed something.
      if is_nil(asked) or said != friendship do
        if Friendship.approved?(said), do: now_friends(kid, friend), else: waiting_on(said, kid, friend, actor)
        changed()
      end

      {:ok, said}
    end
  end

  def ask(_, _, _), do: {:error, "Choose the two kids."}

  @doc "A guardian says yes for their kid's side."
  def approve(%User{} = actor, id) do
    with %Friendship{} = friendship <- Repo.get(Friendship, id) || {:error, :not_found},
         kid = Repo.get(User, friendship.kid_id),
         friend = Repo.get(User, friendship.friend_id),
         true <- guardian_of?(actor, kid) or guardian_of?(actor, friend) || {:error, :forbidden} do
      {:ok, said} = say_yes(actor, friendship, kid, friend)

      if said != friendship do
        if Friendship.approved?(said), do: now_friends(kid, friend), else: waiting_on(said, kid, friend, actor)
        changed()
      end

      {:ok, said}
    end
  end

  @doc "Ends a friendship, or turns down a request: either kid, or a guardian of either."
  def remove(%User{} = actor, id) do
    with %Friendship{} = friendship <- Repo.get(Friendship, id) || {:error, :not_found},
         kid = Repo.get(User, friendship.kid_id),
         friend = Repo.get(User, friendship.friend_id),
         true <-
           actor.id in [friendship.kid_id, friendship.friend_id] or guardian_of?(actor, kid) or guardian_of?(actor, friend) or
             Permissions.can?(actor, :manage_people) || {:error, :forbidden} do
      Repo.delete!(friendship)
      changed()
      :ok
    end
  end

  defp say_yes(actor, friendship, kid, friend) do
    changes =
      []
      |> then(&if(guardian_of?(actor, kid) and is_nil(friendship.kid_ok_by_id), do: [{:kid_ok_by_id, actor.id} | &1], else: &1))
      |> then(&if(guardian_of?(actor, friend) and is_nil(friendship.friend_ok_by_id), do: [{:friend_ok_by_id, actor.id} | &1], else: &1))

    if changes == [], do: {:ok, friendship}, else: friendship |> Ecto.Changeset.change(changes) |> Repo.update()
  end

  defp now_friends(kid, friend), do: Push.family_news([kid.id, friend.id], "New friend", "#{kid.name} and #{friend.name} can chat now.")

  # Lets the guardians who still need to say yes know, on their phones.
  defp waiting_on(friendship, kid, friend, actor) do
    ids =
      for {nil, k} <- [{friendship.kid_ok_by_id, kid}, {friendship.friend_ok_by_id, friend}],
          g <- guardians(k),
          g.id != actor.id,
          uniq: true,
          do: g.id

    if ids != [],
      do: Push.family_news(ids, "Can #{kid.name} and #{friend.name} chat?", "A guardian from each family needs to say yes. Open Family to answer.")
  end

  defp changed, do: FamilyWeb.Endpoint.broadcast("family:presence", "people_changed", %{id: nil})
end
