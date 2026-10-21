defmodule FamilyWeb.Present do
  @moduledoc "The JSON shapes the web app reads."

  alias Family.Permissions
  alias Family.Accounts.User
  alias Family.Chat.{Room, Message, Media}
  alias Family.Games.Game

  def person(%User{} = u) do
    %{
      id: u.id,
      name: u.name,
      role: u.role,
      colour: u.colour,
      avatar: u.avatar,
      active: u.active,
      last_seen_at: u.last_seen_at,
      bubble_id: u.bubble_id
    }
  end

  def bubble(%Family.Accounts.Bubble{} = b) do
    %{
      id: b.id,
      name: b.name,
      emoji: b.emoji,
      home: b.home,
      features: Permissions.bubble_features(b),
      # Grown-ups from other households who are family to its kids.
      relative_ids: Family.Contacts.relative_ids(b)
    }
  end

  def friendship(%Family.Contacts.Friendship{} = f) do
    %{
      id: f.id,
      kid_ids: [f.kid_id, f.friend_id],
      # Who said yes for each kid's household, in the same order.
      ok_by: [f.kid_ok_by_id, f.friend_ok_by_id],
      asked_by_id: f.asked_by_id,
      approved: Family.Contacts.Friendship.approved?(f)
    }
  end

  def event(%Family.Calendar.Event{} = e) do
    %{
      id: e.id,
      title: e.title,
      emoji: e.emoji,
      notes: e.notes,
      location: e.location,
      all_day: e.all_day,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      start_date: e.start_date,
      end_date: e.end_date,
      time_zone: e.time_zone,
      repeat: e.repeat,
      repeat_until: e.repeat_until,
      who: e.who,
      source: e.source,
      # The linked calendar it's from, and whether it repeats there.
      link_id: e.link_id,
      recurring: e.recurring
    }
  end

  @doc "A linked calendar, as someone who sees it sees it. Never its password."
  def link(%Family.Calendar.Link{} = l, %Family.Accounts.User{} = viewer) do
    mine = l.user_id == viewer.id

    %{
      id: l.id,
      user_id: l.user_id,
      provider: l.provider,
      name: l.name,
      color: l.color,
      share: l.share,
      writable: l.writable,
      default: l.default,
      host: Family.Calendar.DAV.host(l.url),
      username: if(mine, do: l.username),
      last_synced_at: l.last_synced_at,
      last_error: l.last_error,
      can_write: Family.Calendar.Links.may_write?(viewer, l),
      can_manage: Family.Calendar.Links.may_manage?(viewer, l)
    }
  end

  def task(%Family.Tasks.Task{} = t) do
    %{
      id: t.id,
      kind: t.kind,
      title: t.title,
      emoji: t.emoji,
      notes: t.notes,
      user_ids: t.user_ids,
      days: t.days,
      on_date: t.on_date,
      part: t.part,
      subject: t.subject,
      due_on: t.due_on,
      status: t.status,
      stars: t.stars,
      pence: t.pence,
      sticker: t.sticker,
      created_by_id: t.created_by_id
    }
  end

  def completion(%Family.Tasks.Completion{} = c),
    do: %{task_id: c.task_id, user_id: c.user_id, on: c.on, done_by_id: c.done_by_id, stars: c.stars, pence: c.pence, sticker: c.sticker}

  def rewards(r) do
    %{
      user_id: r.user_id,
      stars: r.stars,
      earned_pence: r.earned_pence,
      paid_pence: r.paid_pence,
      stickers: r.stickers,
      payouts: Enum.map(r.payouts, &%{id: &1.id, pence: &1.pence, paid_by_id: &1.paid_by_id, paid_at: &1.inserted_at}),
      goals: Enum.map(r.goals, fn {g, progress} -> goal(g, progress) end)
    }
  end

  def goal(%Family.Tasks.Goal{} = g, progress \\ nil),
    do: %{id: g.id, user_id: g.user_id, title: g.title, emoji: g.emoji, stars: g.stars, progress: progress, given_at: g.given_at}

  @doc "What an admin, or a grown-up looking after kids, sees about someone."
  def person_admin(%User{} = u) do
    person(u)
    |> Map.merge(%{
      email: u.email,
      must_change_password: u.must_change_password,
      otp_expires_at: u.otp_expires_at,
      overrides: u.permissions || %{},
      permissions: Permissions.effective(u),
      quiet_hours: u.quiet_hours
    })
  end

  def me(%User{} = u) do
    person(u)
    |> Map.merge(%{
      email: u.email,
      must_change_password: u.must_change_password,
      permissions: Permissions.effective(u),
      quiet_hours: u.quiet_hours,
      quiet_now: Permissions.quiet_now?(u)
    })
  end

  def room(%Room{} = room, %User{} = viewer, last \\ nil, unread \\ 0) do
    members = Enum.map(room.members, & &1.user)
    mine = Enum.find(room.members, &(&1.user_id == viewer.id))
    member = mine != nil

    name =
      cond do
        room.kind != "direct" -> room.name
        member -> (Enum.find(members, &(&1.id != viewer.id)) || %{name: "Someone who left"}).name
        # Someone reading two other people's chat
        true -> members |> Enum.map(& &1.name) |> Enum.sort() |> Enum.join(" & ")
      end

    %{
      id: room.id,
      name: name,
      kind: room.kind,
      emoji: room.emoji,
      created_by_id: room.created_by_id,
      member_ids: Enum.map(members, & &1.id),
      member: member,
      muted: (mine && mine.muted) || false,
      unread: unread,
      last_message: last && preview(last),
      last_message_at: room.last_message_at
    }
  end

  defp preview(%Message{} = m) do
    text =
      cond do
        m.deleted_at -> "Message deleted"
        m.kind == "photo" -> "📷 " <> (m.body || "Photo")
        m.kind == "doodle" -> "🖍️ " <> (m.body || "Doodle")
        m.kind == "game" -> "🎲 Started a game"
        m.kind == "call" -> "📞 Video call"
        true -> m.body || ""
      end

    %{id: m.id, user_id: m.user_id, user_name: m.user && m.user.name, text: String.slice(text, 0, 120)}
  end

  def message(%Message{} = m) do
    %{
      id: m.id,
      room_id: m.room_id,
      user_id: m.user_id,
      kind: m.kind,
      body: m.body,
      media: media(m.media),
      game_id: m.game_id,
      data: m.data,
      deleted: not is_nil(m.deleted_at),
      reply_to: reply(m.reply_to),
      reactions: reactions(m.reactions),
      inserted_at: m.inserted_at
    }
  end

  defp reply(%Message{} = r) do
    %{
      id: r.id,
      user_id: r.user_id,
      kind: r.kind,
      body: if(r.deleted_at, do: nil, else: r.body && String.slice(r.body, 0, 140)),
      media: if(r.deleted_at, do: nil, else: media(r.media)),
      deleted: not is_nil(r.deleted_at)
    }
  end

  defp reply(_), do: nil

  defp reactions(list) when is_list(list) do
    list
    |> Enum.group_by(& &1.emoji, & &1.user_id)
    |> Enum.map(fn {emoji, ids} -> %{emoji: emoji, user_ids: ids} end)
    |> Enum.sort_by(&(-length(&1.user_ids)))
  end

  defp reactions(_), do: []

  def media(%Media{} = m) do
    %{key: m.key, url: "/media/#{m.key}", width: m.width, height: m.height, type: m.content_type}
  end

  def media(_), do: nil

  def game(%Game{} = g) do
    %{
      id: g.id,
      room_id: g.room_id,
      type: g.type,
      mode: g.mode,
      status: g.status,
      title: g.title,
      seats: g.seats,
      state: g.state,
      version: g.version,
      summary: g.summary,
      created_by_id: g.created_by_id,
      last_move_by_id: g.last_move_by_id,
      updated_at: g.updated_at,
      inserted_at: g.inserted_at
    }
  end
end
