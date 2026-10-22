defmodule Family.TasksTest do
  use FamilyWeb.ConnCase, async: false
  import Ecto.Query
  alias Family.{Repo, Tasks}

  setup do
    admin = admin_fixture()
    mia = person_fixture(admin, "kid", "Mia")
    ruby = person_fixture(admin, "kid", "Ruby")
    jo = person_fixture(admin, "grownup", "Jo")
    sam = person_fixture(admin, "grownup", "Sam", %{"bubble_name" => "The Smiths"})
    ollie = person_fixture(admin, "kid", "Ollie", %{"bubble_id" => sam.bubble_id})
    %{admin: admin, mia: mia, ruby: ruby, jo: jo, sam: sam, ollie: ollie}
  end

  defp teeth(ids, extra \\ %{}), do: Map.merge(%{"title" => "Brush teeth", "emoji" => "🪥", "user_ids" => ids, "days" => [1, 2, 3, 4, 5, 6, 7], "part" => "morning"}, extra)

  test "who can set tasks for whom", %{admin: admin, mia: mia, ruby: ruby, jo: jo, sam: sam, ollie: ollie} do
    assert {:ok, task} = Tasks.create(jo, teeth([mia.id, ruby.id]))
    assert task.user_ids == [mia.id, ruby.id]
    assert {:ok, _} = Tasks.create(mia, %{"title" => "Read a chapter", "user_ids" => [mia.id], "days" => [5, 1, 1]})
    assert {:error, :forbidden} = Tasks.create(mia, teeth([ruby.id]))
    assert {:error, :forbidden} = Tasks.create(sam, teeth([mia.id]))
    assert {:ok, _} = Tasks.create(sam, teeth([ollie.id]))
    assert {:ok, _} = Tasks.create(admin, teeth([ollie.id, jo.id]))

    # A kid can't change or remove what a grown-up set.
    assert {:error, :forbidden} = Tasks.update(mia, task.id, %{"title" => "Skip teeth"})
    assert {:error, :forbidden} = Tasks.delete(mia, task.id)
    assert {:ok, %{part: "evening"}} = Tasks.update(jo, task.id, %{"part" => "evening"})

    assert {:error, %Ecto.Changeset{}} = Tasks.create(jo, teeth([mia.id], %{"days" => [], "on_date" => nil}))
    assert {:error, %Ecto.Changeset{}} = Tasks.create(jo, teeth([mia.id], %{"days" => [8]}))
    assert {:error, %Ecto.Changeset{}} = Tasks.create(jo, teeth([]))
  end

  test "each household sees its own chart; admins see everyone's", %{admin: admin, mia: mia, jo: jo, sam: sam, ollie: ollie} do
    {:ok, _} = Tasks.create(jo, teeth([mia.id]))
    {:ok, _} = Tasks.create(sam, teeth([ollie.id], %{"title" => "Feed the cat"}))
    {:ok, _} = Tasks.create(admin, teeth([mia.id, ollie.id], %{"title" => "Tidy up"}))

    titles = fn user -> Tasks.list(user, ~D[2026-10-19], ~D[2026-10-25]) |> elem(0) |> Enum.map(&{&1.title, &1.user_ids}) end
    assert [{"Brush teeth", [mia.id]}, {"Tidy up", [mia.id]}] == titles.(jo)
    assert [{"Feed the cat", [ollie.id]}, {"Tidy up", [ollie.id]}] == titles.(sam)
    assert length(titles.(admin)) == 3
  end

  test "ticking off, by the person or their grown-up, on days it's due", %{mia: mia, ruby: ruby, jo: jo, sam: sam} do
    {:ok, daily} = Tasks.create(jo, teeth([mia.id, ruby.id]))
    {:ok, once} = Tasks.create(jo, %{"title" => "Pack for camp", "user_ids" => [mia.id], "on_date" => "2026-10-24"})

    FamilyWeb.Endpoint.subscribe("user:#{jo.id}")
    assert :ok = Tasks.tick(mia, daily.id, mia.id, ~D[2026-10-20], true)
    assert_receive %{event: "tasks_changed"}
    assert :ok = Tasks.tick(mia, daily.id, mia.id, ~D[2026-10-20], true)
    assert :ok = Tasks.tick(jo, daily.id, ruby.id, ~D[2026-10-20], true)
    assert {:error, :forbidden} = Tasks.tick(mia, daily.id, ruby.id, ~D[2026-10-21], true)
    assert {:error, :forbidden} = Tasks.tick(sam, daily.id, mia.id, ~D[2026-10-21], true)
    assert {:error, "That task isn't theirs."} = Tasks.tick(jo, once.id, ruby.id, ~D[2026-10-24], true)
    assert {:error, "That task isn't for that day."} = Tasks.tick(mia, once.id, mia.id, ~D[2026-10-23], true)
    assert :ok = Tasks.tick(mia, once.id, mia.id, ~D[2026-10-24], true)

    {_, done} = Tasks.list(jo, ~D[2026-10-19], ~D[2026-10-25])
    assert [{daily.id, mia.id, mia.id}, {daily.id, ruby.id, jo.id}, {once.id, mia.id, mia.id}] ==
             Enum.map(done, &{&1.task_id, &1.user_id, &1.done_by_id})

    assert :ok = Tasks.tick(mia, daily.id, mia.id, ~D[2026-10-20], false)
    {_, done} = Tasks.list(jo, ~D[2026-10-20], ~D[2026-10-20])
    assert [_] = done
  end

  test "tasks over the API", %{conn: conn, mia: mia} do
    jo = sign_in(conn, "jo@example.com", "Jo password")
    %{"task" => %{"id" => id, "days" => [1, 2, 3, 4, 5, 6, 7]}} = jo |> post("/api/tasks", teeth([mia.id])) |> json_response(200)

    kid = sign_in(build_conn() |> put_req_header("x-family", "1"), "mia@example.com", "Mia password")
    today = Tasks.today()
    assert %{"ok" => true} = kid |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => "#{today}"}) |> json_response(200)
    on = to_string(today)

    assert %{"tasks" => [%{"id" => ^id}], "done" => [%{"on" => ^on, "user_id" => user_id}]} =
             kid |> get("/api/tasks?from=#{Date.add(today, -1)}&to=#{Date.add(today, 5)}") |> json_response(200)

    assert user_id == mia.id
    assert kid |> patch("/api/tasks/#{id}", %{"title" => "No"}) |> json_response(403)
    assert %{"ok" => true} = kid |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => on, "done" => false}) |> json_response(200)

    # Days are kept near today: a week back for kids, a month for grown-ups, and never ahead.
    assert %{"error" => "That's too long ago to change now."} =
             kid |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => "#{Date.add(today, -8)}"}) |> json_response(422)

    assert %{"error" => "That day hasn't come yet."} =
             kid |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => "#{Date.add(today, 2)}"}) |> json_response(422)

    assert %{"ok" => true} = jo |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => "#{Date.add(today, -8)}"}) |> json_response(200)
    assert %{"ok" => true} = jo |> delete("/api/tasks/#{id}") |> json_response(200)
    assert %{"error" => "That isn't here any more."} = jo |> delete("/api/tasks/first") |> json_response(404)
    assert jo |> get("/api/tasks?from=2026-10-19&to=2027-10-25") |> json_response(422)
  end

  test "a bubble without tasks neither sees them nor gets them", %{admin: admin, mia: mia, sam: sam, ollie: ollie} do
    {:ok, ollies} = Tasks.create(sam, teeth([ollie.id]))
    {:ok, _} = Family.Accounts.update_bubble(admin, Family.Accounts.get_bubble(sam.bubble_id), %{"features" => %{"tasks" => false}})

    assert {[], []} = Tasks.list(sam, ~D[2026-10-19], ~D[2026-10-25])
    assert {:error, :forbidden} = Tasks.create(sam, teeth([ollie.id]))
    assert {:error, :forbidden} = Tasks.tick(ollie, ollies.id, ollie.id, ~D[2026-10-20], true)
    assert {:error, "Tasks are switched off for someone on this task."} = Tasks.create(admin, teeth([mia.id, ollie.id]))

    # The admin's chart leaves Ollie out until tasks come back.
    {tasks, _} = Tasks.list(admin, ~D[2026-10-19], ~D[2026-10-25])
    refute Enum.any?(tasks, &(&1.id == ollies.id))
  end

  test "rewards: stars, pocket money and stickers, and paying out", %{admin: admin, mia: mia, ruby: ruby, jo: jo, sam: sam} do
    {:ok, bed} = Tasks.create(jo, teeth([mia.id], %{"title" => "Make the bed", "stars" => 2, "pence" => 50, "sticker" => true}))
    assert :ok = Tasks.tick(mia, bed.id, mia.id, ~D[2026-10-19], true)
    assert :ok = Tasks.tick(jo, bed.id, mia.id, ~D[2026-10-20], true)

    # Changing the task later doesn't change what was already earned.
    {:ok, _} = Tasks.update(jo, bed.id, %{"pence" => 100})

    # Kids don't see what their brothers and sisters are paid.
    {:ok, rubys} = Tasks.create(jo, teeth([ruby.id], %{"title" => "Feed the cat", "pence" => 30}))
    :ok = Tasks.tick(jo, rubys.id, ruby.id, ~D[2026-10-20], true)
    {tasks, done} = Tasks.list(mia, ~D[2026-10-20], ~D[2026-10-20])
    assert %{pence: 0} = Enum.find(tasks, &(&1.id == rubys.id))
    assert %{pence: 100} = Enum.find(tasks, &(&1.id == bed.id))
    assert Enum.all?(done, &(&1.pence == 0 or &1.user_id == mia.id))
    assert %{pence: 30} = jo |> Tasks.list(~D[2026-10-20], ~D[2026-10-20]) |> elem(0) |> Enum.find(&(&1.id == rubys.id))
    mine = fn who -> Enum.find(Tasks.rewards(who), &(&1.user_id == mia.id)) end
    assert %{stars: 4, earned_pence: 100, paid_pence: 0, stickers: [%{sticker: a}, %{sticker: b}]} = mine.(jo)
    assert a in Tasks.stickers() and b in Tasks.stickers()

    # Grown-ups who look after Mia mark it paid; not Mia, not another family.
    assert {:error, :forbidden} = Tasks.pay(mia, mia.id, 100)
    assert {:error, :forbidden} = Tasks.pay(sam, mia.id, 100)
    assert {:ok, payout} = Tasks.pay(jo, mia.id, 60)
    assert %{paid_pence: 60} = mine.(mia)
    assert [%{user_id: id}] = Tasks.rewards(mia)
    assert id == mia.id
    assert :ok = Tasks.unpay(admin, payout.id)
    assert %{paid_pence: 0} = mine.(admin)

    # Kids can make tasks for themselves, but rewards come from grown-ups, so
    # a kid's own task earns nothing, whoever changes it.
    {:ok, own} = Tasks.create(mia, teeth([mia.id], %{"title" => "Read", "pence" => 500, "stars" => 5, "sticker" => true}))
    assert %{pence: 0, stars: 0, sticker: false} = own
    {:ok, own} = Tasks.update(jo, own.id, %{"stars" => 2, "sticker" => true, "title" => "Read every day"})
    assert %{title: "Read every day", stars: 0, sticker: false} = own
    {:ok, own} = Tasks.update(mia, own.id, %{"title" => "Read a chapter", "stars" => 5, "pence" => 500})
    assert %{title: "Read a chapter", pence: 0, stars: 0} = own
    :ok = Tasks.tick(mia, own.id, mia.id, ~D[2026-10-21], true)
    assert %{stars: 4, stickers: [_, _]} = mine.(jo)

    # One a kid made before that rule came in may still carry a sticker; any change takes it off.
    Repo.update_all(from(t in Tasks.Task, where: t.id == ^own.id), set: [sticker: true, stars: 1])
    {:ok, own} = Tasks.update(jo, own.id, %{"title" => "Read two chapters"})
    assert %{stars: 0, sticker: false} = own

    # A grown-up's task can still be changed by them without touching its rewards.
    {:ok, bed} = Tasks.update(jo, bed.id, %{"title" => "Make the bed nicely"})
    assert %{stars: 2, sticker: true} = bed
  end

  test "goals: a treat for so many stars", %{mia: mia, jo: jo} do
    assert {:error, :forbidden} = Tasks.create_goal(mia, %{"user_id" => mia.id, "title" => "Lots of sweets", "stars" => 1})
    {:ok, goal} = Tasks.create_goal(jo, %{"user_id" => mia.id, "title" => "Trip to the park", "emoji" => "🛝", "stars" => 3})
    {:ok, read} = Tasks.create(jo, teeth([mia.id], %{"title" => "Read", "stars" => 2}))
    assert :ok = Tasks.tick(mia, read.id, mia.id, ~D[2026-10-19], true)

    [{^goal, 2}] = Enum.find(Tasks.rewards(jo), &(&1.user_id == mia.id)).goals
    assert {:ok, %{given_at: %DateTime{}}} = Tasks.update_goal(jo, goal.id, %{"given" => true})
    assert {:ok, %{given_at: nil}} = Tasks.update_goal(jo, goal.id, %{"given" => false})
    assert {:error, :forbidden} = Tasks.delete_goal(mia, goal.id)
    assert :ok = Tasks.delete_goal(jo, goal.id)
  end

  test "reminders are for grown-ups at home, about a child", %{admin: admin, mia: mia, jo: jo, sam: sam} do
    pe = %{"kind" => "reminder", "title" => "PE kit", "emoji" => "👟", "user_ids" => [mia.id], "days" => [2], "stars" => 3, "pence" => 20}
    {:ok, reminder} = Tasks.create(jo, pe)
    assert %{kind: "reminder", stars: 0, pence: 0} = reminder

    seen = fn who -> who |> Tasks.list(~D[2026-10-19], ~D[2026-10-25]) |> elem(0) |> Enum.any?(&(&1.id == reminder.id)) end
    assert seen.(jo) and seen.(admin)
    refute seen.(mia) or seen.(sam)

    assert {:error, :forbidden} = Tasks.tick(mia, reminder.id, mia.id, ~D[2026-10-20], true)
    assert {:error, :forbidden} = Tasks.update(mia, reminder.id, %{"title" => "No PE"})
    assert {:error, :forbidden} = Tasks.delete(mia, reminder.id)
    assert :ok = Tasks.tick(jo, reminder.id, mia.id, ~D[2026-10-20], true)
    assert %{stars: 0} = Enum.find(Tasks.rewards(jo), &(&1.user_id == mia.id))
  end

  test "kids set reminders for themselves, and their grown-ups see them too", %{mia: mia, ruby: ruby, jo: jo, sam: sam} do
    swim = %{"kind" => "reminder", "title" => "Swimming bag", "emoji" => "🏊", "user_ids" => [mia.id], "days" => [4]}
    assert {:error, :forbidden} = Tasks.create(mia, Map.put(swim, "user_ids", [ruby.id]))
    {:ok, own} = Tasks.create(mia, swim)
    {:ok, jos} = Tasks.create(jo, %{swim | "title" => "Library book"})

    seen = fn who -> who |> Tasks.list(~D[2026-10-19], ~D[2026-10-25]) |> elem(0) |> Enum.filter(&(&1.kind == "reminder")) |> Enum.map(& &1.title) end
    assert seen.(mia) == ["Swimming bag"]
    assert seen.(jo) == ["Swimming bag", "Library book"]
    assert seen.(ruby) == [] and seen.(sam) == []

    assert :ok = Tasks.tick(mia, own.id, mia.id, ~D[2026-10-22], true)
    assert {:ok, %{title: "Swimming kit"}} = Tasks.update(mia, own.id, %{"title" => "Swimming kit"})
    assert {:error, :forbidden} = Tasks.tick(mia, jos.id, mia.id, ~D[2026-10-22], true)
    assert :ok = Tasks.delete(mia, own.id)
  end

  test "homework: set, moved along and handed in on time for its reward", %{mia: mia, ruby: ruby, jo: jo, sam: sam} do
    maths = %{"kind" => "homework", "title" => "Times tables", "subject" => "Maths", "user_ids" => [mia.id], "on_date" => "2026-10-19", "due_on" => "2026-10-21", "sticker" => true}
    assert {:error, %Ecto.Changeset{}} = Tasks.create(jo, Map.put(maths, "user_ids", [mia.id, ruby.id]))
    assert {:error, %Ecto.Changeset{}} = Tasks.create(jo, Map.put(maths, "due_on", "2026-10-18"))
    {:ok, hw} = Tasks.create(jo, maths)
    assert %{status: "todo", days: []} = hw

    assert {:error, "Homework is handed in rather than ticked."} = Tasks.tick(mia, hw.id, mia.id, ~D[2026-10-19], true)
    assert {:error, :forbidden} = Tasks.set_status(sam, hw.id, "started", ~D[2026-10-19])
    assert {:ok, %{status: "started"}} = Tasks.set_status(mia, hw.id, "started", ~D[2026-10-19])
    assert {:ok, %{status: "handed_in"}} = Tasks.set_status(mia, hw.id, "handed_in", ~D[2026-10-21])
    assert %{stars: 1, stickers: [_]} = Enum.find(Tasks.rewards(jo), &(&1.user_id == mia.id))

    # Moved back, the reward goes; handed in late, it doesn't come back.
    assert {:ok, _} = Tasks.set_status(jo, hw.id, "done", ~D[2026-10-21])
    assert {:ok, _} = Tasks.set_status(mia, hw.id, "handed_in", ~D[2026-10-22])
    assert %{stars: 0, stickers: []} = Enum.find(Tasks.rewards(jo), &(&1.user_id == mia.id))
  end

  test "rewards and homework over the API", %{conn: conn, mia: mia} do
    jo = sign_in(conn, "jo@example.com", "Jo password")
    task = teeth([mia.id], %{"pence" => 25})
    %{"task" => %{"id" => id, "pence" => 25, "kind" => "job"}} = jo |> post("/api/tasks", task) |> json_response(200)

    kid = sign_in(build_conn() |> put_req_header("x-family", "1"), "mia@example.com", "Mia password")
    kid |> post("/api/tasks/#{id}/done", %{"user_id" => mia.id, "on" => "#{Tasks.today()}"}) |> json_response(200)

    assert %{"rewards" => rewards, "stickers" => [_ | _]} = jo |> get("/api/rewards") |> json_response(200)
    assert %{"earned_pence" => 25, "stars" => 1} = Enum.find(rewards, &(&1["user_id"] == mia.id))
    assert kid |> post("/api/rewards/#{mia.id}/paid", %{"pence" => 25}) |> json_response(403)
    assert %{"ok" => true} = jo |> post("/api/rewards/#{mia.id}/paid", %{"pence" => 25}) |> json_response(200)

    today = Tasks.today()
    hw = %{"kind" => "homework", "title" => "Spellings", "user_ids" => [mia.id], "on_date" => "#{today}", "due_on" => "#{Date.add(today, 2)}", "stars" => 5}
    %{"task" => %{"id" => hw_id, "stars" => 0}} = kid |> post("/api/tasks", hw) |> json_response(200)

    assert %{"error" => "That's too long ago to change now."} =
             kid |> post("/api/tasks/#{hw_id}/status", %{"status" => "handed_in", "on" => "#{Date.add(today, -2)}"}) |> json_response(422)

    assert %{"task" => %{"status" => "handed_in"}} = kid |> post("/api/tasks/#{hw_id}/status", %{"status" => "handed_in", "on" => "#{today}"}) |> json_response(200)

    %{"goal" => %{"id" => goal_id, "progress" => nil}} = jo |> post("/api/goals", %{"user_id" => mia.id, "title" => "Cinema", "stars" => 10}) |> json_response(200)
    assert %{"goal" => %{"given_at" => given}} = jo |> patch("/api/goals/#{goal_id}", %{"given" => true}) |> json_response(200)
    assert given
  end
end
