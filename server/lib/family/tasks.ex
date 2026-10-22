defmodule Family.Tasks do
  @moduledoc """
  Daily tasks: small jobs that come round on chosen days of the week (or once),
  ticked off by each person they're for. Two other kinds live alongside them:
  reminders of what a child needs on a day (PE kit, swimming bag), which
  grown-ups set for the kids at home and kids can set for themselves; and
  homework, set on one day, due on another, and moved along from to do to
  handed in. A child never sees the reminders grown-ups set about them.

  Everyone sees the tasks of the people in their own bubble, so a household
  has one chart; admins see everyone's. Anyone can set tasks for themselves,
  grown-ups who look after kids set them for those kids, and admins for
  anyone. Kids only change the tasks they set themselves. A task is ticked
  off by its person, or by a grown-up who looks after them. Days are the
  family's own: the web app says which day it is. Tasks are a feature the
  home family can switch off for another bubble, and people without it
  neither see tasks nor get them.

  Jobs and homework can earn rewards: stars, pocket money and stickers. Each
  tick keeps what it earned. Grown-ups mark pocket money paid, and set goals
  (a treat for so many stars) for the kids they look after. Rewards come from
  grown-ups, so the tasks kids set themselves earn none.
  """

  import Ecto.Query
  alias Family.{Accounts, Permissions, Repo}
  alias Family.Accounts.User
  alias Family.Tasks.{Task, Completion, Payout, Goal}

  @stickers ~w(🦄 🌈 ⭐ 🐶 🦊 🐼 🦋 🌻 🍓 🚀 🎈 🐬 🦖 🍩 🏰 🐝 🐢 🦁 🐙 🍉 🎨 🧁 🐧 🌙 🦉 🐞 🍒 🎠 🐳 🌸)

  def stickers, do: @stickers

  @doc "The people whose tasks someone can see."
  def visible_ids(%User{} = user) do
    query =
      cond do
        not Permissions.can?(user, :tasks) -> from(u in User, where: false)
        Permissions.can?(user, :manage_people) -> from(u in User, where: u.active)
        true -> from(u in User, where: u.active and (u.id == ^user.id or (not is_nil(u.bubble_id) and u.bubble_id == ^user.bubble_id)))
      end

    query |> Repo.all() |> Enum.filter(&Permissions.can?(&1, :tasks)) |> Enum.map(& &1.id)
  end

  @doc "Whether someone may set, change or tick off tasks for a person."
  def can_set?(%User{id: id}, %User{id: id}), do: true
  def can_set?(%User{} = actor, %User{} = person), do: Permissions.can?(actor, :manage_people) or Accounts.looks_after?(actor, person)
  def can_set?(_, _), do: false

  @doc """
  The tasks someone can see, and the ticks between two days. Reminders show
  only to grown-ups in the child's own bubble, and homework handed in long
  before these days is left out. Kids don't see what their brothers and
  sisters are paid.
  """
  def list(%User{} = user, %Date{} = from, %Date{} = to) do
    visible = visible_ids(user)
    reminded = reminded_ids(user, visible)
    long_ago = Date.add(from, -30)

    tasks =
      Repo.all(from t in Task, order_by: [asc: t.id])
      |> Enum.reject(&(&1.kind == "homework" and &1.status == "handed_in" and Date.compare(&1.due_on, long_ago) == :lt))
      |> Enum.map(fn t ->
        people =
          cond do
            t.kind != "reminder" -> visible
            user.role == "kid" -> if t.created_by_id == user.id and user.id in visible, do: [user.id], else: []
            true -> reminded
          end

        %{t | user_ids: Enum.filter(t.user_ids, &(&1 in people))}
      end)
      |> Enum.reject(&(&1.user_ids == []))

    ids = Enum.map(tasks, & &1.id)

    done =
      Repo.all(from c in Completion, where: c.task_id in ^ids and c.user_id in ^visible and c.on >= ^from and c.on <= ^to, order_by: c.id)

    if user.role == "kid" do
      {Enum.map(tasks, &if(user.id in &1.user_ids, do: &1, else: %{&1 | pence: 0})),
       Enum.map(done, &if(&1.user_id == user.id, do: &1, else: %{&1 | pence: 0}))}
    else
      {tasks, done}
    end
  end

  # Reminders are for the grown-ups of the children in their own bubble, and
  # kids see only the ones they set themselves.
  defp reminded_ids(%User{role: "kid"}, _), do: []
  defp reminded_ids(%User{bubble_id: nil}, _), do: []

  defp reminded_ids(%User{bubble_id: bubble}, visible),
    do: Repo.all(from u in User, where: u.id in ^visible and u.bubble_id == ^bubble, select: u.id)

  def create(%User{} = user, attrs) do
    task = if user.role == "kid", do: %Task{created_by_id: user.id, stars: 0, pence: 0, sticker: false}, else: %Task{created_by_id: user.id}
    changeset = Task.changeset(task, clean(attrs, user))

    with :ok <- uses_tasks(user),
         :ok <- may_set_all(user, Ecto.Changeset.get_field(changeset, :user_ids)),
         {:ok, task} <- Repo.insert(changeset) do
      changed(task.user_ids)
      {:ok, task}
    end
  end

  def update(%User{} = user, id, attrs) do
    with :ok <- uses_tasks(user),
         %Task{} = task <- Repo.get(Task, id) || {:error, :not_found},
         :ok <- may_remind(user, task),
         :ok <- may_change(user, task),
         changeset = Task.changeset(task, clean(attrs, user, task)),
         :ok <- may_set_all(user, Ecto.Changeset.get_field(changeset, :user_ids)),
         {:ok, updated} <- Repo.update(changeset) do
      changed(task.user_ids ++ updated.user_ids)
      {:ok, updated}
    end
  end

  def delete(%User{} = user, id) do
    with :ok <- uses_tasks(user),
         %Task{} = task <- Repo.get(Task, id) || {:error, :not_found},
         :ok <- may_remind(user, task),
         :ok <- may_change(user, task) do
      Repo.delete!(task)
      changed(task.user_ids)
      :ok
    end
  end

  @doc "Ticks a task off for someone on a day, or takes the tick away."
  def tick(%User{} = actor, task_id, person_id, %Date{} = on, done?) do
    with :ok <- uses_tasks(actor),
         %Task{} = task <- Repo.get(Task, task_id) || {:error, :not_found},
         true <- task.kind != "homework" || {:error, "Homework is handed in rather than ticked."},
         :ok <- may_remind(actor, task),
         true <- person_id in task.user_ids || {:error, "That task isn't theirs."},
         %User{} = person <- Accounts.get_user(person_id) || {:error, :not_found},
         true <- can_set?(actor, person) || {:error, :forbidden},
         :ok <- uses_tasks(person),
         true <- due?(task, on) || {:error, "That task isn't for that day."} do
      existing = Repo.get_by(Completion, task_id: task.id, user_id: person.id, on: on)

      cond do
        done? and is_nil(existing) ->
          Repo.insert!(earned(%Completion{task_id: task.id, user_id: person.id, on: on, done_by_id: actor.id}, task))

        not done? and existing ->
          Repo.delete!(existing)

        true ->
          :ok
      end

      changed([person.id])
      :ok
    end
  end

  @doc """
  Moves homework along: to do, started, done, handed in. Handing it in by the
  day it's due earns its reward; moving it back takes the reward away.
  """
  def set_status(%User{} = actor, task_id, status, %Date{} = on) do
    with :ok <- uses_tasks(actor),
         %Task{} = task <- Repo.get(Task, task_id) || {:error, :not_found},
         true <- task.kind == "homework" || {:error, "Only homework moves along like that."},
         true <- status in Task.statuses() || {:error, "That isn't a step homework can be at."},
         %User{} = person <- Accounts.get_user(hd(task.user_ids)) || {:error, :not_found},
         true <- can_set?(actor, person) || {:error, :forbidden} do
      if status == task.status do
        {:ok, task}
      else
        {:ok, task} =
          Repo.transaction(fn ->
            task = task |> Ecto.Changeset.change(status: status) |> Repo.update!()
            Repo.delete_all(from c in Completion, where: c.task_id == ^task.id)

            if status == "handed_in" and Date.compare(on, task.due_on) != :gt,
              do: Repo.insert!(earned(%Completion{task_id: task.id, user_id: person.id, on: on, done_by_id: actor.id}, task))

            task
          end)

        changed(task.user_ids)
        {:ok, task}
      end
    end
  end

  # What a tick earns: the task's stars and pocket money, and a sticker picked at random.
  defp earned(%Completion{} = c, %Task{} = task),
    do: %{c | stars: task.stars, pence: task.pence, sticker: if(task.sticker, do: Enum.random(@stickers))}

  ## Rewards

  @doc """
  Everyone's stars, pocket money, stickers and goals, for the people whose
  tasks someone can see. Kids see only their own, so pocket money stays
  between a child and their grown-ups.
  """
  def rewards(%User{} = user) do
    ids = visible_ids(user)
    ids = if user.role == "kid", do: Enum.filter(ids, &(&1 == user.id)), else: ids
    earned = Repo.all(from c in Completion, where: c.user_id in ^ids, order_by: c.id) |> Enum.group_by(& &1.user_id)
    paid = Repo.all(from p in Payout, where: p.user_id in ^ids, order_by: [desc: p.id]) |> Enum.group_by(& &1.user_id)
    goals = Repo.all(from g in Goal, where: g.user_id in ^ids, order_by: g.id) |> Enum.group_by(& &1.user_id)

    Enum.map(ids, fn id ->
      earned = Map.get(earned, id, [])
      paid = Map.get(paid, id, [])

      %{
        user_id: id,
        stars: total(earned, & &1.stars),
        earned_pence: total(earned, & &1.pence),
        paid_pence: total(paid, & &1.pence),
        stickers: for(c <- earned, c.sticker, do: %{sticker: c.sticker, on: c.on, task_id: c.task_id}),
        payouts: paid,
        goals:
          for g <- Map.get(goals, id, []) do
            {g, total(Enum.filter(earned, &(DateTime.compare(&1.inserted_at, g.inserted_at) != :lt)), & &1.stars)}
          end
      }
    end)
  end

  defp total(items, field), do: items |> Enum.map(field) |> Enum.sum()

  @doc "A grown-up marks pocket money paid to a child they look after."
  def pay(%User{} = actor, person_id, pence) do
    with :ok <- uses_tasks(actor),
         %User{} = person <- Accounts.get_user(person_id) || {:error, :not_found},
         :ok <- rewards_for(actor, person),
         true <- (is_integer(pence) and pence > 0 and pence <= 100_000) || {:error, "Choose how much was paid."} do
      payout = Repo.insert!(%Payout{user_id: person.id, pence: pence, paid_by_id: actor.id})
      changed([person.id])
      {:ok, payout}
    end
  end

  @doc "Takes back a payment marked by mistake."
  def unpay(%User{} = actor, id) do
    with %Payout{} = payout <- Repo.get(Payout, id) || {:error, :not_found},
         %User{} = person <- Accounts.get_user(payout.user_id) || {:error, :not_found},
         :ok <- rewards_for(actor, person) do
      Repo.delete!(payout)
      changed([person.id])
      :ok
    end
  end

  def create_goal(%User{} = actor, attrs) do
    with :ok <- uses_tasks(actor),
         {person_id, _} when is_integer(person_id) <- {attrs["user_id"], nil},
         %User{} = person <- Accounts.get_user(person_id) || {:error, :not_found},
         :ok <- rewards_for(actor, person),
         {:ok, goal} <- %Goal{user_id: person.id, created_by_id: actor.id} |> Goal.changeset(attrs) |> Repo.insert() do
      changed([person.id])
      {:ok, goal}
    else
      {_, nil} -> {:error, "Choose who the goal is for."}
      other -> other
    end
  end

  @doc "Changes a goal, or marks its treat given (or not, after all)."
  def update_goal(%User{} = actor, id, attrs) do
    with %Goal{} = goal <- Repo.get(Goal, id) || {:error, :not_found},
         %User{} = person <- Accounts.get_user(goal.user_id) || {:error, :not_found},
         :ok <- rewards_for(actor, person),
         changeset = Goal.changeset(goal, attrs),
         changeset =
           (case attrs["given"] do
              true -> Ecto.Changeset.put_change(changeset, :given_at, goal.given_at || DateTime.utc_now(:second))
              false -> Ecto.Changeset.put_change(changeset, :given_at, nil)
              _ -> changeset
            end),
         {:ok, goal} <- Repo.update(changeset) do
      changed([person.id])
      {:ok, goal}
    end
  end

  def delete_goal(%User{} = actor, id) do
    with %Goal{} = goal <- Repo.get(Goal, id) || {:error, :not_found},
         %User{} = person <- Accounts.get_user(goal.user_id) || {:error, :not_found},
         :ok <- rewards_for(actor, person) do
      Repo.delete!(goal)
      changed([person.id])
      :ok
    end
  end

  # Grown-ups who look after a child (or an admin) handle their rewards; nobody does their own.
  defp rewards_for(%User{id: id}, %User{id: id}), do: {:error, :forbidden}

  defp rewards_for(actor, person) do
    if Permissions.can?(actor, :tasks) and can_set?(actor, person), do: :ok, else: {:error, :forbidden}
  end

  @doc "The family's today, in its own time zone."
  def today, do: Application.get_env(:family, :time_zone, "Europe/London") |> DateTime.now!() |> DateTime.to_date()

  @doc "Whether a task comes round on a day."
  def due?(%Task{on_date: %Date{} = d}, on), do: Date.compare(d, on) == :eq
  def due?(%Task{days: days}, on), do: Date.day_of_week(on) in days

  # The reminders grown-ups set about a kid stay with the grown-ups; a kid
  # handles only the ones they set themselves.
  defp may_remind(%User{role: "kid", id: id}, %Task{kind: "reminder", created_by_id: by}) when by != id, do: {:error, :forbidden}
  defp may_remind(_, _), do: :ok

  defp may_change(%User{role: "kid", id: id}, %Task{created_by_id: by}) when by != id, do: {:error, :forbidden}
  defp may_change(user, task), do: may_set_all(user, task.user_ids)

  defp may_set_all(user, ids) do
    people = Repo.all(from u in User, where: u.id in ^(ids || []))

    cond do
      length(people) != length(Enum.uniq(ids || [])) -> {:error, "Everyone on a task must be in the family."}
      not Enum.all?(people, &can_set?(user, &1)) -> {:error, :forbidden}
      not Enum.all?(people, &Permissions.can?(&1, :tasks)) -> {:error, "Tasks are switched off for someone on this task."}
      true -> :ok
    end
  end

  defp by_kid?(nil), do: false
  defp by_kid?(id), do: Repo.exists?(from u in User, where: u.id == ^id and u.role == "kid")

  defp uses_tasks(user), do: if(Permissions.can?(user, :tasks), do: :ok, else: {:error, :forbidden})

  # Rewards come from grown-ups: kids leave them as they are, and a task a kid
  # set themselves earns none, whoever changes it.
  defp clean(attrs, user, %Task{created_by_id: by}) do
    cond do
      by_kid?(by) -> attrs |> clean(nil) |> Map.merge(%{"stars" => 0, "pence" => 0, "sticker" => false})
      user.role == "kid" -> clean(attrs, %User{role: "kid"})
      true -> clean(attrs, user)
    end
  end

  defp clean(attrs, %User{role: "kid"}), do: attrs |> clean(nil) |> Map.drop(~w(stars pence sticker))

  defp clean(attrs, _) do
    attrs
    |> Map.take(~w(kind title emoji notes user_ids days on_date part subject due_on stars pence sticker))
    |> Map.new(fn
      {k, v} when k in ~w(user_ids days) -> {k, if(is_list(v), do: Enum.filter(v, &is_integer/1) |> Enum.uniq(), else: [])}
      {k, ""} when k in ~w(on_date due_on) -> {k, nil}
      kv -> kv
    end)
  end

  # Everyone who can see these people's tasks fetches them again.
  defp changed(person_ids) do
    people = Repo.all(from u in User, where: u.id in ^Enum.uniq(person_ids))
    bubbles = people |> Enum.map(& &1.bubble_id) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    Repo.all(from u in User, where: u.active and (u.id in ^person_ids or u.bubble_id in ^bubbles or u.role == "admin"), select: u.id)
    |> Enum.each(&Family.Chat.notify_user(&1, "tasks_changed", %{}))
  end
end
