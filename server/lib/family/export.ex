defmodule Family.Export do
  @moduledoc """
  Downloads. Anyone can take away everything the app keeps about them, and
  an admin can take the whole family's chats, photos, calendar and tasks.
  Each is a zip of JSON files that people and other programs can read, with
  the photos and doodles beside them in `media/`.

  Passwords, sign-ins, linked calendars' passwords and notification keys
  never go in, and nor do calendars someone keeps to themselves, unless it's
  their own download.
  """

  import Ecto.Query
  alias Family.{Permissions, Repo}
  alias Family.Accounts.{Bubble, User}
  alias Family.Calendar.{Event, Link}
  alias Family.Chat.{Media, Member, Message, Reaction, Room}
  alias Family.Games.Game
  alias Family.Push.Subscription
  alias Family.Tasks.{Completion, Goal, Payout, Task}

  @doc "Everything about one person. Gives `{:ok, path, filename}`; the caller deletes the file."
  def person(%User{} = user) do
    user = Repo.preload(user, :bubble)
    names = names()
    rooms = Repo.all(from r in Room, join: m in Member, on: m.room_id == r.id and m.user_id == ^user.id, preload: [members: :user])

    messages =
      Repo.all(
        from m in Message,
          where: m.user_id == ^user.id and is_nil(m.deleted_at) and m.kind in ~w(text photo doodle),
          order_by: m.id,
          preload: :media
      )

    reactions =
      Repo.all(from r in Reaction, join: m in assoc(r, :message), where: r.user_id == ^user.id, select: {m.room_id, m.inserted_at, r.emoji, r.inserted_at})

    chat_names = Map.new(Repo.all(from r in Room, preload: [members: :user]), &{&1.id, room_name(&1, user)})

    chats =
      (Enum.map(messages, & &1.room_id) ++ Enum.map(reactions, &elem(&1, 0)))
      |> Enum.uniq()
      |> Enum.map(fn room_id ->
        %{
          chat: chat_names[room_id],
          messages: for(m <- messages, m.room_id == room_id, do: message(m, names, false)),
          reactions: for({^room_id, on, emoji, at} <- reactions, do: %{emoji: emoji, on_message_from: on, at: at})
        }
      end)

    # The reminders grown-ups set are their notes about a kid, so a kid's own
    # download keeps only the reminders they set themselves (a reminder whose
    # grown-up has left has no setter, and stays hidden).
    hidden =
      if user.role == "kid",
        do: MapSet.new(Repo.all(from t in Task, where: t.kind == "reminder" and (is_nil(t.created_by_id) or t.created_by_id != ^user.id), select: t.id)),
        else: MapSet.new()

    tasks = Repo.all(from t in Task, order_by: t.id) |> Enum.filter(&(user.id in &1.user_ids and not MapSet.member?(hidden, &1.id)))
    task_titles = Map.new(Repo.all(from t in Task, select: {t.id, t.title}))
    links = Repo.all(from l in Link, where: l.user_id == ^user.id, order_by: l.id)

    me = %{
      name: user.name,
      email: Family.Accounts.User.email(user),
      role: user.role,
      family: user.bubble && user.bubble.name,
      colour: user.colour,
      picture: user.avatar,
      joined: user.inserted_at,
      last_seen_at: user.last_seen_at,
      abilities: Permissions.effective(user),
      quiet_hours: user.quiet_hours,
      chats: Enum.map(rooms, &room_name(&1, user)),
      notification_devices:
        Repo.all(from s in Subscription, where: s.user_id == ^user.id, order_by: s.id)
        |> Enum.map(&%{device: &1.device, since: &1.inserted_at, last_used_at: &1.last_used_at}),
      linked_calendars: Enum.map(links, &link(&1, :own)),
      holiday_phrases_known: Family.Phrases.keys(user)
    }

    events =
      Repo.all(from e in Event, where: is_nil(e.link_id) or e.link_id in ^Enum.map(links, & &1.id), order_by: [e.start_date, e.starts_at])
      |> Enum.filter(&(&1.created_by_id == user.id or user.id in (&1.who || []) or not is_nil(&1.link_id)))
      |> Enum.map(&event(&1, names, links))

    games =
      Repo.all(from g in Game, order_by: g.id)
      |> Enum.filter(&(user.id in Map.values(&1.seats || %{}) or &1.created_by_id == user.id))
      |> Enum.map(&game(&1, names, chat_names))

    files = [
      {"README.txt", readme(:person, user.name)},
      {"me.json", me},
      {"chats.json", chats},
      {"calendar.json", events},
      {"tasks.json",
       %{
         tasks: Enum.map(tasks, &task(&1, names)),
         ticks:
           Repo.all(from c in Completion, where: c.user_id == ^user.id, order_by: c.on)
           |> Enum.reject(&MapSet.member?(hidden, &1.task_id))
           |> Enum.map(&tick(&1, task_titles, names)),
         pocket_money_paid: Repo.all(from p in Payout, where: p.user_id == ^user.id, order_by: p.id) |> Enum.map(&payout(&1, names)),
         goals: Repo.all(from g in Goal, where: g.user_id == ^user.id, order_by: g.id) |> Enum.map(&goal(&1, names))
       }},
      {"games.json", games}
    ]

    zip(files, Repo.all(from m in Media, where: m.user_id == ^user.id), "kitchen-table-#{slug(user.name)}-#{Date.utc_today()}.zip")
  end

  @doc "The whole family, for an admin. Gives `{:ok, path, filename}`; the caller deletes the file."
  def family do
    names = names()
    rooms = Repo.all(from r in Room, order_by: r.id, preload: [members: :user])
    shared_links = Repo.all(from l in Link, where: l.share == "family", order_by: l.id)

    people =
      Repo.all(from u in User, order_by: u.id, preload: :bubble)
      |> Enum.map(
        &%{
          name: &1.name,
          email: Family.Accounts.User.email(&1),
          role: &1.role,
          family: &1.bubble && &1.bubble.name,
          switched_on: &1.active,
          joined: &1.inserted_at,
          last_seen_at: &1.last_seen_at,
          quiet_hours: &1.quiet_hours
        }
      )

    bubbles = Repo.all(from b in Bubble, order_by: b.id) |> Enum.map(&%{name: &1.name, emoji: &1.emoji, home: &1.home, features: Permissions.bubble_features(&1)})
    task_titles = Map.new(Repo.all(from t in Task, select: {t.id, t.title}))
    chat_names = Map.new(rooms, &{&1.id, room_name(&1, nil)})

    chats =
      rooms
      |> Enum.with_index(1)
      |> Enum.map(fn {room, n} ->
        messages =
          Repo.all(from m in Message, where: m.room_id == ^room.id, order_by: m.id, preload: [:media, reactions: :user])
          |> Enum.map(&message(&1, names, true))

        {"chats/#{String.pad_leading(to_string(n), 3, "0")}-#{slug(chat_names[room.id])}.json",
         %{chat: chat_names[room.id], kind: room.kind, people: Enum.map(room.members, & &1.user.name), messages: messages}}
      end)

    events =
      Repo.all(from e in Event, where: is_nil(e.link_id) or e.link_id in ^Enum.map(shared_links, & &1.id), order_by: [e.start_date, e.starts_at])
      |> Enum.map(&event(&1, names, shared_links))

    files =
      [
        {"README.txt", readme(:family, nil)},
        {"family.json", %{families: bubbles, people: people, linked_calendars: Enum.map(shared_links, &link(&1, :family))}},
        {"calendar.json", events},
        {"tasks.json",
         %{
           tasks: Repo.all(from t in Task, order_by: t.id) |> Enum.map(&task(&1, names)),
           ticks: Repo.all(from c in Completion, order_by: [c.on, c.id]) |> Enum.map(&tick(&1, task_titles, names)),
           pocket_money_paid: Repo.all(from p in Payout, order_by: p.id) |> Enum.map(&payout(&1, names)),
           goals: Repo.all(from g in Goal, order_by: g.id) |> Enum.map(&goal(&1, names))
         }},
        {"games.json", Repo.all(from g in Game, order_by: g.id) |> Enum.map(&game(&1, names, chat_names))}
      ] ++ chats

    zip(files, Repo.all(from m in Media, order_by: m.id), "kitchen-table-family-#{Date.utc_today()}.zip")
  end

  ## Pieces

  defp names, do: Map.new(Repo.all(from u in User, select: {u.id, u.name}))
  defp name(names, id), do: id && Map.get(names, id, "Someone who left")

  defp room_name(%Room{kind: "direct", members: members}, viewer) do
    others = for %{user: u} <- members, viewer == nil or u.id != viewer.id, do: u.name
    if others == [], do: "Someone who left", else: Enum.join(others, " & ")
  end

  defp room_name(%Room{name: name}, _), do: name

  defp message(%Message{} = m, names, everyone?) do
    base = %{at: m.inserted_at, kind: m.kind}
    base = if everyone?, do: Map.put(base, :from, name(names, m.user_id) || "Kitchen Table"), else: base

    cond do
      m.deleted_at ->
        Map.put(base, :deleted, true)

      true ->
        base
        |> put_some(:text, m.body)
        |> put_some(:picture, m.media && media_name(m.media))
        |> put_some(:details, if(m.kind in ~w(system call), do: m.data))
        |> put_some(:reactions, if(everyone? and m.reactions != [], do: Enum.map(m.reactions, &%{from: &1.user.name, emoji: &1.emoji})))
    end
  end

  defp event(%Event{} = e, names, links) do
    %{
      title: e.title,
      emoji: e.emoji,
      all_day: e.all_day,
      starts: e.starts_at || e.start_date,
      ends: e.ends_at || e.end_date,
      time_zone: e.time_zone,
      repeats: e.repeat,
      repeats_until: e.repeat_until,
      where: e.location,
      notes: e.notes,
      who: Enum.map(e.who || [], &name(names, &1)),
      calendar: (e.link_id && Enum.find_value(links, &(&1.id == e.link_id && &1.name))) || "Kitchen Table",
      added_by: name(names, e.created_by_id)
    }
  end

  # Someone's own download has their links in full. The family's has only
  # where each one is: a calendar's address can be the key to it.
  defp link(%Link{} = l, :own), do: %{name: l.name, kind: l.provider, address: l.url, username: l.username, shared_with: l.share, last_copied_at: l.last_synced_at}
  defp link(%Link{} = l, :family), do: %{name: l.name, kind: l.provider, at: link_at(l), shared_with: l.share, last_copied_at: l.last_synced_at}

  # A Google or Outlook calendar's ID is often its owner's email address, so only where it's kept.
  defp link_at(%Link{provider: "google"}), do: "google.com"
  defp link_at(%Link{provider: "microsoft"}), do: "outlook.com"
  defp link_at(%Link{url: url}), do: URI.parse(url).host

  defp task(%Task{} = t, names) do
    %{
      kind: t.kind,
      title: t.title,
      emoji: t.emoji,
      for: Enum.map(t.user_ids, &name(names, &1)),
      days: t.days,
      on: t.on_date,
      part_of_day: t.part,
      subject: t.subject,
      due: t.due_on,
      status: t.status,
      notes: t.notes,
      stars: t.stars,
      pence: t.pence,
      sticker: t.sticker,
      set_by: name(names, t.created_by_id)
    }
  end

  defp tick(%Completion{} = c, titles, names),
    do: %{task: titles[c.task_id], who: name(names, c.user_id), on: c.on, ticked_by: name(names, c.done_by_id), stars: c.stars, pence: c.pence, sticker: c.sticker}

  defp payout(%Payout{} = p, names), do: %{to: name(names, p.user_id), pence: p.pence, paid_by: name(names, p.paid_by_id), at: p.inserted_at}

  defp goal(%Goal{} = g, names), do: %{for: name(names, g.user_id), title: g.title, emoji: g.emoji, stars: g.stars, given_at: g.given_at, set_by: name(names, g.created_by_id)}

  defp game(%Game{} = g, names, chats) do
    %{
      game: g.type,
      chat: chats[g.room_id],
      how: g.mode,
      status: g.status,
      players: Map.new(g.seats || %{}, fn {seat, who} -> {seat, if(is_integer(who), do: name(names, who), else: who)} end),
      result: g.summary,
      started: g.inserted_at,
      started_by: name(names, g.created_by_id)
    }
  end

  defp media_name(%Media{} = media), do: media.key |> Family.Chat.media_path(media.content_type) |> Path.relative_to(data_dir())

  defp put_some(map, _key, nil), do: map
  defp put_some(map, key, value), do: Map.put(map, key, value)

  defp slug(text) do
    text
    |> String.downcase()
    |> String.replace(~r/[^\p{L}\p{N}]+/u, "-")
    |> String.trim("-")
    |> String.slice(0, 40)
    |> case do
      "" -> "chat"
      s -> s
    end
  end

  defp readme(:person, name) do
    """
    Kitchen Table: everything the app keeps about #{name}

    me.json        your profile, what you can do, your notification devices
                   and the calendars you linked (without their passwords)
    chats.json     the messages you wrote and the reactions you gave, by chat
    calendar.json  events you added or are in, and those in calendars you linked
    tasks.json     your tasks and homework, every tick, pocket money paid and goals
    games.json     the games you played
    media/         the photos and doodles you shared, named as in chats.json

    Times are in UTC. Downloaded on #{Date.utc_today()}.
    """
  end

  defp readme(:family, _) do
    """
    Kitchen Table: the whole family

    family.json    the families, the people in them and the calendars they share
    chats/         every chat, one file each, with every message and reaction
    calendar.json  the family calendar, with the linked calendars everyone sees
    tasks.json     every task and homework, every tick, pocket money and goals
    games.json     every game played
    media/         every photo and doodle, named as in the chats

    Calendars someone keeps to themselves aren't included. Times are in UTC.
    Downloaded on #{Date.utc_today()}.
    """
  end

  ## The zip

  # Written to a file rather than kept in memory: a family's photos add up.
  defp zip(files, media, filename) do
    path = Path.join(System.tmp_dir!(), "kitchen-table-#{System.unique_integer([:positive])}.zip")

    entries =
      Enum.map(files, fn
        {name, text} when is_binary(text) -> {name, {:data, text}}
        {name, data} -> {name, {:data, Jason.encode_to_iodata!(data, pretty: true) |> IO.iodata_to_binary()}}
      end) ++
        (media
         |> Enum.map(&media_name/1)
         |> Enum.uniq()
         |> Enum.map(&{&1, Path.join(data_dir(), &1)})
         |> Enum.filter(&File.regular?(elem(&1, 1)))
         |> Enum.map(fn {name, file} -> {name, {:file, file}} end))

    :ok = Family.Zip.create(path, entries)
    {:ok, path, filename}
  end

  defp data_dir, do: Application.fetch_env!(:family, :data_dir)
end
