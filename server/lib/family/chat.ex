defmodule Family.Chat do
  @moduledoc """
  Rooms and messages. There is one room with the whole family in it; grown-ups
  can make smaller rooms, and anyone allowed can message one person directly.
  Admins can read every room, including ones they aren't in, and grown-ups
  who look after kids can read every room their own bubble's kids are in.
  Reading isn't taking part: they can't write, react or call there, and nobody
  sees them reading.
  """

  import Ecto.Query
  alias Family.{Repo, Permissions, Contacts}
  alias Family.Accounts.User
  alias Family.Chat.{Room, Member, Message, Reaction, Media}
  alias FamilyWeb.Present

  @page 60
  @max_body 4000
  @reaction_emoji ~w(❤️ 😂 😮 👏 👍 🌟 🦄 🐶)

  def reaction_emoji, do: @reaction_emoji

  ## Rooms

  def family_room, do: Repo.one(from r in Room, where: r.kind == "family", limit: 1)

  def ensure_family_room(%User{} = user) do
    room =
      family_room() ||
        Repo.insert!(%Room{name: "Whole family", kind: "family", emoji: "🏡", created_by_id: user.id})

    add_member(room, user)
    room
  end

  def add_to_family_room(%User{} = user) do
    case family_room() do
      nil -> ensure_family_room(user)
      room -> add_member(room, user)
    end
  end

  @doc "For someone moving out of the home bubble."
  def remove_from_family_room(%User{} = user) do
    if room = family_room() do
      Repo.delete_all(from m in Member, where: m.room_id == ^room.id and m.user_id == ^user.id)
    end
  end

  defp add_member(room, user) do
    Repo.insert!(%Member{room_id: room.id, user_id: user.id},
      on_conflict: :nothing,
      conflict_target: [:room_id, :user_id]
    )

    room
  end

  @doc """
  The rooms someone is in, newest activity first, with unread counts. After
  those come the rooms they can only read (every other room for an admin, the
  rooms their kids are in for a grown-up), with no unread count.
  """
  def list_rooms(%User{} = user) do
    rooms =
      from(r in Room,
        join: m in Member,
        on: m.room_id == r.id and m.user_id == ^user.id,
        order_by: [desc: r.kind == "family", desc_nulls_last: r.last_message_at, asc: r.id],
        preload: [members: :user],
        select: {r, m.last_read_id}
      )
      |> Repo.all()

    ids = Enum.map(rooms, fn {r, _} -> r.id end)
    others =
      cond do
        reads_all?(user) -> other_rooms(ids)
        (kids = kids_of(user)) != [] -> other_rooms(ids, kids)
        true -> []
      end

    last = last_messages(ids ++ Enum.map(others, & &1.id))
    unread = unread_counts(user, rooms)
    all = Enum.map(rooms, &elem(&1, 0)) ++ others
    facts = all |> Enum.flat_map(fn r -> Enum.map(r.members, & &1.user) end) |> Enum.uniq_by(& &1.id) |> Contacts.facts()
    closed = fn room -> Contacts.why_not(Enum.map(room.members, & &1.user), facts) end

    Enum.map(rooms, fn {room, _} ->
      room |> Present.room(user, Map.get(last, room.id), Map.get(unread, room.id, 0)) |> Map.put(:closed, closed.(room))
    end) ++ Enum.map(others, &(&1 |> Present.room(user, Map.get(last, &1.id)) |> Map.put(:closed, closed.(&1))))
  end

  defp other_rooms(ids) do
    from(r in Room,
      where: r.id not in ^ids,
      order_by: [desc_nulls_last: r.last_message_at, asc: r.id],
      preload: [members: :user]
    )
    |> Repo.all()
  end

  defp other_rooms(ids, kids) do
    theirs = from m in Member, where: m.user_id in ^kids, select: m.room_id

    from(r in Room,
      where: r.id not in ^ids and r.id in subquery(theirs),
      order_by: [desc_nulls_last: r.last_message_at, asc: r.id],
      preload: [members: :user]
    )
    |> Repo.all()
  end

  defp last_messages([]), do: %{}

  defp last_messages(room_ids) do
    latest = from m in Message, where: m.room_id in ^room_ids, group_by: m.room_id, select: max(m.id)

    from(m in Message, where: m.id in subquery(latest), preload: [:user])
    |> Repo.all()
    |> Map.new(&{&1.room_id, &1})
  end

  defp unread_counts(user, rooms) do
    Map.new(rooms, fn {room, last_read} ->
      count =
        Repo.aggregate(
          from(m in Message,
            where:
              m.room_id == ^room.id and m.id > ^last_read and is_nil(m.deleted_at) and
                (is_nil(m.user_id) or m.user_id != ^user.id)
          ),
          :count
        )

      {room.id, count}
    end)
  end

  def member?(%User{id: user_id}, room_id) do
    Repo.exists?(from m in Member, where: m.room_id == ^room_id and m.user_id == ^user_id)
  end

  @doc "Admins can read every room."
  def reads_all?(%User{} = user), do: Permissions.can?(user, :manage_people)

  @doc """
  Whether someone may read a room: they're in it, they're an admin, or one of
  the kids they look after is in it.
  """
  def can_read?(%User{} = user, room_id) do
    member?(user, room_id) or
      (reads_all?(user) and Repo.exists?(from r in Room, where: r.id == ^room_id)) or
      case kids_of(user) do
        [] -> false
        kids -> Repo.exists?(from m in Member, where: m.room_id == ^room_id and m.user_id in ^kids)
      end
  end

  # The kids a grown-up looks after: the kids in their own family bubble.
  defp kids_of(%User{role: "grownup", bubble_id: bubble_id} = user) when not is_nil(bubble_id) do
    if Permissions.can?(user, :manage_kids),
      do: Repo.all(from u in User, where: u.bubble_id == ^bubble_id and u.role == "kid", select: u.id),
      else: []
  end

  defp kids_of(_), do: []

  def get_room(%User{} = user, room_id) do
    if member?(user, room_id),
      do: Repo.get(Room, room_id) |> Repo.preload(members: :user),
      else: nil
  end

  def member_ids(room_id) do
    Repo.all(from m in Member, where: m.room_id == ^room_id, select: m.user_id)
  end

  @doc "Makes a room for some of the family."
  def create_room(%User{} = user, attrs) do
    name = attrs |> Map.get("name", "") |> to_string() |> String.trim()
    emoji = attrs |> Map.get("emoji", "💬") |> to_string() |> String.slice(0, 8)
    member_ids = active_ids([user.id | List.wrap(attrs["member_ids"])])

    cond do
      not Permissions.can?(user, :create_rooms) -> {:error, :forbidden}
      name == "" -> {:error, "Give the group a name."}
      String.length(name) > 40 -> {:error, "Keep the name to 40 characters."}
      length(member_ids) < 2 -> {:error, "Choose at least one other person."}
      (why = Contacts.why_not(users(member_ids))) != nil -> {:error, why}
      true ->
        room =
          Repo.transaction(fn ->
            room = Repo.insert!(%Room{name: name, kind: "group", emoji: emoji, created_by_id: user.id})
            Enum.each(member_ids, &Repo.insert!(%Member{room_id: room.id, user_id: &1}))
            room
          end)
          |> elem(1)

        notify_readers(room.id, "rooms_changed", %{})
        {:ok, room}
    end
  end

  @doc "The room for two people, made the first time either messages the other."
  def direct_room(%User{} = user, other_id) do
    other = Repo.get(User, other_id)

    cond do
      not Permissions.can?(user, :direct_messages) -> {:error, :forbidden}
      is_nil(other) or not other.active or other.id == user.id -> {:error, :not_found}
      (why = Contacts.why_not([user, other])) != nil -> {:error, why}
      true ->
        existing =
          from(r in Room,
            join: a in Member, on: a.room_id == r.id and a.user_id == ^user.id,
            join: b in Member, on: b.room_id == r.id and b.user_id == ^other.id,
            where: r.kind == "direct",
            limit: 1
          )
          |> Repo.one()

        room =
          existing ||
            Repo.transaction(fn ->
              room = Repo.insert!(%Room{name: "", kind: "direct", emoji: "💌", created_by_id: user.id})
              Repo.insert!(%Member{room_id: room.id, user_id: user.id})
              Repo.insert!(%Member{room_id: room.id, user_id: other.id})
              room
            end)
            |> elem(1)

        if is_nil(existing), do: notify_readers(room.id, "rooms_changed", %{})
        {:ok, room}
    end
  end

  @doc "Renames a group room or changes who is in it: its maker or an admin."
  def update_room(%User{} = user, %Room{kind: "group"} = room, attrs) do
    wanted = if ids = attrs["member_ids"], do: active_ids([user.id | List.wrap(ids)])
    why = wanted && Contacts.why_not(users(wanted))

    cond do
      not (room.created_by_id == user.id or Permissions.can?(user, :manage_people)) -> {:error, :forbidden}
      why -> {:error, why}
      true -> change_room(room, attrs, wanted)
    end
  end

  def update_room(_, _, _), do: {:error, :forbidden}

  defp change_room(room, attrs, wanted) do
    before = member_ids(room.id)

    Repo.transaction(fn ->
      changes =
        %{}
        |> then(&if(n = attrs["name"], do: Map.put(&1, :name, String.slice(String.trim(n), 0, 40)), else: &1))
        |> then(&if(e = attrs["emoji"], do: Map.put(&1, :emoji, String.slice(e, 0, 8)), else: &1))

      room = room |> Ecto.Changeset.change(changes) |> Repo.update!()

      if wanted do
        Repo.delete_all(from m in Member, where: m.room_id == ^room.id and m.user_id not in ^wanted)
        Enum.each(wanted -- before, &Repo.insert!(%Member{room_id: room.id, user_id: &1}))
      end

      room
    end)
    |> tap(fn _ ->
      Enum.each(Enum.uniq(before ++ member_ids(room.id)), &notify_user(&1, "rooms_changed", %{}))
    end)
  end

  defp users(ids), do: Repo.all(from u in User, where: u.id in ^ids)

  defp active_ids(ids) do
    ids = ids |> Enum.map(&to_int/1) |> Enum.reject(&is_nil/1) |> Enum.uniq()
    Repo.all(from u in User, where: u.id in ^ids and u.active, select: u.id)
  end

  defp to_int(i) when is_integer(i), do: i

  defp to_int(s) when is_binary(s) do
    case Integer.parse(s) do
      {i, ""} -> i
      _ -> nil
    end
  end

  defp to_int(_), do: nil

  ## Messages

  def list_messages(room_id, before_id \\ nil) do
    query =
      from m in Message,
        where: m.room_id == ^room_id,
        order_by: [desc: m.id],
        limit: @page,
        preload: [:user, :media, :game, reactions: :user, reply_to: [:user, :media]]

    query = if before_id, do: where(query, [m], m.id < ^before_id), else: query
    query |> Repo.all() |> Enum.reverse() |> Enum.map(&Present.message/1)
  end

  def get_message(id) do
    Repo.get(Message, id) |> Repo.preload([:user, :media, :game, reactions: :user, reply_to: [:user, :media]])
  end

  @doc """
  Posts a message. `kind` is text, photo or doodle; photos and doodles carry a
  media id from an upload to the same room.
  """
  def post_message(%User{} = user, room_id, attrs) do
    kind = attrs["kind"] || "text"
    body = attrs |> Map.get("body") |> clean_body()
    media_id = attrs["media_id"]

    with :ok <- may_post(user, room_id, kind),
         :ok <- check_content(kind, body, media_id, user, room_id) do
      reply_to = valid_reply(attrs["reply_to_id"], room_id)

      message =
        Repo.insert!(%Message{
          room_id: room_id,
          user_id: user.id,
          kind: kind,
          body: body,
          media_id: if(kind in ~w(photo doodle), do: media_id),
          reply_to_id: reply_to,
          data: clean_data(kind, attrs["data"])
        })

      after_post(message)
    end
  end

  @doc "A line from the app itself, such as a game starting."
  def post_system(room_id, attrs) do
    Repo.insert!(struct(Message, Map.merge(%{room_id: room_id, kind: "system"}, attrs)))
    |> after_post()
  end

  @doc "Replaces a message's data, such as a call's length once it ends."
  def update_message_data(message_id, data) do
    with %Message{} = message <- Repo.get(Message, message_id) do
      message |> Ecto.Changeset.change(data: data) |> Repo.update!()
      payload = Present.message(get_message(message.id))
      FamilyWeb.Endpoint.broadcast("room:#{message.room_id}", "message:updated", payload)
      :ok
    end
  end

  defp after_post(message) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    Repo.update_all(from(r in Room, where: r.id == ^message.room_id), set: [last_message_at: now])
    message = get_message(message.id)
    payload = Present.message(message)
    FamilyWeb.Endpoint.broadcast("room:#{message.room_id}", "message:new", payload)
    notify_readers(message.room_id, "room_activity", %{room_id: message.room_id, message: payload})
    Family.Push.message_posted(message)
    {:ok, message}
  end

  defp may_post(user, room_id, kind) do
    needed =
      case kind do
        "photo" -> :share_photos
        "doodle" -> :doodle
        "text" -> :send_messages
        _ -> nil
      end

    cond do
      is_nil(needed) -> {:error, "That kind of message isn't supported."}
      not member?(user, room_id) -> {:error, :forbidden}
      not Permissions.can?(user, :send_messages) -> {:error, :forbidden}
      not Permissions.can?(user, needed) -> {:error, :forbidden}
      Permissions.quiet_now?(user) -> {:error, :quiet_hours}
      true -> Contacts.check_room(room_id)
    end
  end

  defp check_content("text", body, _, _, _) do
    cond do
      is_nil(body) -> {:error, "Write a message first."}
      String.length(body) > @max_body -> {:error, "Keep messages under #{@max_body} characters."}
      true -> :ok
    end
  end

  defp check_content(_photo_or_doodle, body, media_id, user, room_id) do
    media = media_id && Repo.get(Media, media_id)

    cond do
      body && String.length(body) > @max_body -> {:error, "Keep captions under #{@max_body} characters."}
      is_nil(media) or media.room_id != room_id or media.user_id != user.id -> {:error, "That photo didn't upload."}
      true -> :ok
    end
  end

  defp clean_body(nil), do: nil

  defp clean_body(body) do
    case body |> to_string() |> String.trim() do
      "" -> nil
      trimmed -> trimmed
    end
  end

  # A doodle can say which photo it was drawn on.
  defp clean_data("doodle", %{"on_message_id" => id}) when is_integer(id), do: %{"on_message_id" => id}
  defp clean_data(_, _), do: nil

  defp valid_reply(nil, _), do: nil

  defp valid_reply(id, room_id) do
    case Repo.get(Message, id) do
      %Message{room_id: ^room_id} -> id
      _ -> nil
    end
  end

  def delete_message(%User{} = user, message_id) do
    message = Repo.get(Message, message_id)

    cond do
      is_nil(message) or not member?(user, message.room_id) ->
        {:error, :not_found}

      message.kind in ~w(system game call) ->
        {:error, :forbidden}

      message.user_id != user.id and not may_tidy?(user, message) ->
        {:error, :forbidden}

      true ->
        now = DateTime.utc_now() |> DateTime.truncate(:second)
        message |> Ecto.Changeset.change(deleted_at: now, body: nil, media_id: nil) |> Repo.update!()
        Repo.delete_all(from r in Reaction, where: r.message_id == ^message.id)
        payload = Present.message(get_message(message.id))
        FamilyWeb.Endpoint.broadcast("room:#{message.room_id}", "message:updated", payload)
        :ok
    end
  end

  # Grown-ups tidy up messages from their own family bubble; admins, anyone's.
  defp may_tidy?(user, message) do
    reads_all?(user) or
      (Permissions.can?(user, :delete_others_messages) and not is_nil(user.bubble_id) and
         Repo.exists?(from u in User, where: u.id == ^message.user_id and u.bubble_id == ^user.bubble_id))
  end

  def toggle_reaction(%User{} = user, message_id, emoji) do
    message = Repo.get(Message, message_id)

    cond do
      emoji not in @reaction_emoji -> {:error, "Pick one of the reactions."}
      is_nil(message) or not member?(user, message.room_id) -> {:error, :not_found}
      message.deleted_at -> {:error, :not_found}
      true ->
        existing = Repo.get_by(Reaction, message_id: message.id, user_id: user.id, emoji: emoji)

        if existing,
          do: Repo.delete!(existing),
          else: Repo.insert!(%Reaction{message_id: message.id, user_id: user.id, emoji: emoji})

        payload = Present.message(get_message(message.id))
        FamilyWeb.Endpoint.broadcast("room:#{message.room_id}", "message:updated", payload)
        :ok
    end
  end

  def mark_read(%User{} = user, room_id, message_id) when is_integer(message_id) do
    from(m in Member,
      where: m.room_id == ^room_id and m.user_id == ^user.id and m.last_read_id < ^message_id
    )
    |> Repo.update_all(set: [last_read_id: message_id])

    :ok
  end

  def mark_read(_, _, _), do: :ok

  ## Media

  @max_bytes 15_000_000
  @types %{"image/jpeg" => "jpg", "image/png" => "png", "image/webp" => "webp", "image/gif" => "gif"}

  def max_upload_bytes, do: @max_bytes

  @doc "Keeps an uploaded picture for a room, checking it really is an image."
  def store_media(%User{} = user, room_id, %Plug.Upload{path: path}, dims) do
    with true <- member?(user, room_id) || {:error, :forbidden},
         true <- (Permissions.can?(user, :share_photos) or Permissions.can?(user, :doodle)) || {:error, :forbidden},
         %{size: size} when size <= @max_bytes <- File.stat!(path),
         {:ok, type} <- sniff(path) do
      key = :crypto.strong_rand_bytes(18) |> Base.url_encode64(padding: false)
      dest = media_path(key, type)
      File.mkdir_p!(Path.dirname(dest))
      File.cp!(path, dest)

      media =
        Repo.insert!(%Media{
          user_id: user.id,
          room_id: room_id,
          key: key,
          content_type: type,
          bytes: size,
          width: dim(dims["width"]),
          height: dim(dims["height"])
        })

      {:ok, media}
    else
      %{size: _} -> {:error, "That photo is too big. Try a smaller one."}
      {:error, _} = error -> error
    end
  end

  defp dim(v) do
    case to_int(v) do
      n when is_integer(n) and n > 0 and n < 20_000 -> n
      _ -> nil
    end
  end

  def media_path(key, type), do: Path.join([data_dir(), "media", String.slice(key, 0, 2), "#{key}.#{@types[type]}"])

  defp data_dir, do: Application.fetch_env!(:family, :data_dir)

  def get_media_for(%User{} = user, key) do
    case Repo.get_by(Media, key: key) do
      %Media{} = media -> if can_read?(user, media.room_id), do: media
      nil -> nil
    end
  end

  defp sniff(path) do
    head = File.open!(path, [:read, :binary], &IO.binread(&1, 12))

    case head do
      <<0xFF, 0xD8, 0xFF, _::binary>> -> {:ok, "image/jpeg"}
      <<0x89, "PNG", _::binary>> -> {:ok, "image/png"}
      <<"RIFF", _::binary-size(4), "WEBP">> -> {:ok, "image/webp"}
      <<"GIF8", _::binary>> -> {:ok, "image/gif"}
      _ -> {:error, "Only photos can be shared (JPEG, PNG, WebP or GIF)."}
    end
  end

  ## Notifications to each person's own channel

  def notify_members(room_id, event, payload) do
    Enum.each(member_ids(room_id), &notify_user(&1, event, payload))
  end

  @doc "Tells everyone who can read the room: its members, admins, and the grown-ups of kids in it."
  def notify_readers(room_id, event, payload) do
    members = member_ids(room_id)
    Enum.each(Enum.uniq(members ++ readers(members)), &notify_user(&1, event, payload))
  end

  defp readers(member_ids) do
    bubbles =
      Repo.all(
        from u in User,
          where: u.id in ^member_ids and u.role == "kid" and not is_nil(u.bubble_id),
          distinct: true,
          select: u.bubble_id
      )

    from(u in User, where: u.active and (u.role == "admin" or (u.role == "grownup" and u.bubble_id in ^bubbles)))
    |> Repo.all()
    |> Enum.filter(&(&1.role == "admin" or Permissions.can?(&1, :manage_kids)))
    |> Enum.map(& &1.id)
  end

  def notify_user(user_id, event, payload) do
    FamilyWeb.Endpoint.broadcast("user:#{user_id}", event, payload)
  end
end
