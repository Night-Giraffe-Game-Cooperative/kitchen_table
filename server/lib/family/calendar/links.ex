defmodule Family.Calendar.Links do
  @moduledoc """
  Calendars kept elsewhere, shown in the family calendar.

  Anyone who can change the family calendar can link one. A CalDAV calendar
  (iCloud, Fastmail, Nextcloud and the like) goes both ways: its events show
  here, and events added or changed here are saved in it. So do Google and
  Outlook calendars, once someone signs in to their account
  (Family.Calendar.Connect). A calendar's address (an .ics feed, such as a
  school's) is shown here only.

  Whoever links a calendar chooses who sees it: the whole family, or only
  them. When it's the family's, anyone who can change the family calendar
  can add to it. Linked events are copied here for a few months behind and a
  year ahead, one row per occurrence; an event that repeats there is changed
  there.
  """

  import Ecto.Query
  require Logger
  alias Family.{Permissions, Repo}
  alias Family.Accounts.User
  alias Family.Calendar
  alias Family.Calendar.{Account, Connect, DAV, Event, Google, ICal, Link, Microsoft, Vault}

  # Reached through an account someone signed in to.
  @signed_in ~w(google microsoft)

  @behind_days 90
  @ahead_days 400

  ## Who may do what

  def get(id), do: Repo.get(Link, id)

  @doc "The linked calendars someone sees: the family's, and their own."
  def visible(%User{} = user) do
    if Calendar.can_see?(user),
      do: Repo.all(from l in Link, where: l.share == "family" or l.user_id == ^user.id, order_by: [l.name, l.id]),
      else: []
  end

  def visible_ids(%User{id: id}), do: from(l in Link, where: l.share == "family" or l.user_id == ^id, select: l.id)

  def can_link?(%User{} = user), do: Calendar.can_edit?(user)

  @doc "Whether someone may add to or change a linked calendar's events."
  def may_write?(%User{} = user, %Link{} = link) do
    link.writable and Calendar.can_edit?(user) and (link.user_id == user.id or link.share == "family")
  end

  @doc "Whether someone may change a link's settings or remove it: whoever made it, or an admin for the family's."
  def may_manage?(%User{} = user, %Link{} = link) do
    link.user_id == user.id or (link.share == "family" and Permissions.can?(user, :manage_people))
  end

  defp may_link(user), do: if(can_link?(user), do: :ok, else: {:error, :forbidden})

  ## Linking

  @doc """
  The calendars an account has, for choosing which to link. `provider` is
  "icloud" (an Apple ID and an app-specific password) or "caldav" (any
  other server's address, a username and a password).
  """
  def discover(%User{} = user, attrs) do
    with :ok <- may_link(user),
         {:ok, provider, url} <- server(attrs),
         {:ok, auth} <- auth(attrs) do
      url |> DAV.discover(auth) |> signed_in(provider)
    end
  end

  @doc """
  Links calendars. For CalDAV, `calendars` lists the addresses chosen from
  `discover/2`; each becomes a link. For a feed, `url` is its address.
  Each is copied here straight away.
  """
  def add(%User{} = user, %{"provider" => "ics"} = attrs) do
    with :ok <- may_link(user),
         {:ok, url} <- DAV.address(attrs["url"] || ""),
         {:ok, feed} <- DAV.fetch(url) do
      name = present(attrs["name"]) || feed_name(feed.data) || DAV.host(url)

      with {:ok, link} <- insert(user, attrs, %{provider: "ics", url: url, name: String.slice(name, 0, 60), writable: false}) do
        sync(link, feed: feed)
        {:ok, [get(link.id)]}
      end
    end
  end

  def add(%User{} = user, %{"provider" => provider} = attrs) when provider in @signed_in do
    chosen = attrs["calendars"] |> List.wrap() |> Enum.filter(&is_map/1)

    with :ok <- may_link(user),
         :ok <- if(chosen == [], do: {:error, "Choose at least one calendar."}, else: :ok),
         {:ok, account} <- own_account(user, attrs["account"], provider),
         # Only the calendars the account really has, as the provider describes them.
         {:ok, found} <- with_token(account, &api(provider).calendars/1) |> account_error(account) do
      link_picked(user, attrs, found, chosen, %{provider: provider, account_id: account.id, username: account.email, secret: nil})
    end
  end

  def add(%User{} = user, attrs) do
    chosen = attrs["calendars"] |> List.wrap() |> Enum.filter(&is_map/1)

    with :ok <- may_link(user),
         :ok <- if(chosen == [], do: {:error, "Choose at least one calendar."}, else: :ok),
         {:ok, provider, url} <- server(attrs),
         {:ok, {username, password} = auth} <- auth(attrs),
         # Only the calendars the account really has, as the server describes them.
         {:ok, found} <- url |> DAV.discover(auth) |> signed_in(provider) do
      link_picked(user, attrs, found, chosen, %{provider: "caldav", username: username, secret: Vault.seal(password)})
    end
  end

  # Links the calendars someone chose from those an account has, each copied here straight away.
  defp link_picked(user, attrs, found, chosen, fields) do
    names = Map.new(chosen, &{&1["url"], present(&1["name"])})
    picked = Enum.filter(found, &Map.has_key?(names, &1.url))
    default? = attrs["share"] != "me" and not Repo.exists?(from l in Link, where: l.default)

    if picked == [] do
      {:error, "Those calendars weren't found. Look for them again."}
    else
      Repo.transaction(fn ->
        picked
        |> Enum.with_index()
        |> Enum.map(fn {cal, i} ->
          fields =
            Map.merge(fields, %{
              url: cal.url,
              name: String.slice(names[cal.url] || cal.name, 0, 60),
              color: cal.color,
              writable: cal.writable,
              # The first family calendar that can be added to is where new events go.
              default: default? and cal.writable and i == Enum.find_index(picked, & &1.writable),
              ctag: nil
            })

          case insert(user, attrs, fields) do
            {:ok, link} -> link
            {:error, changeset} -> Repo.rollback(changeset)
          end
        end)
      end)
      |> case do
        {:ok, links} ->
          Enum.each(links, &sync/1)
          {:ok, Enum.map(links, &get(&1.id))}

        error ->
          error
      end
    end
  end

  @doc """
  The calendars in a Google or Microsoft account someone has just signed in
  to, for choosing which to link: `{:ok, account, calendars}`.
  """
  def account_calendars(%User{} = user, account_id) do
    with :ok <- may_link(user),
         {:ok, account} <- own_account(user, account_id, nil),
         {:ok, calendars} <- with_token(account, &api(account.provider).calendars/1) |> account_error(account) do
      {:ok, account, calendars}
    end
  end

  defp own_account(%User{id: user_id}, id, provider) do
    with {id, ""} <- Integer.parse(to_string(id || "")),
         %Account{user_id: ^user_id} = account <- Repo.get(Account, id),
         true <- is_nil(provider) or account.provider == provider do
      {:ok, account}
    else
      _ -> {:error, "Sign in to that account again, then choose its calendars."}
    end
  end

  defp account_error({:error, reason}, %Account{} = account) when reason in [:signed_out, :unauthorized],
    do: {:error, "#{Connect.name(account.provider)} wouldn't let the app in. Sign in again."}

  defp account_error({:error, reason}, %Account{} = account) when not is_binary(reason) do
    Logger.warning("#{Connect.name(account.provider)} account #{account.id}: #{inspect(reason) |> String.slice(0, 200)}")
    {:error, "#{Connect.name(account.provider)} couldn't be reached just now. Try again in a minute."}
  end

  defp account_error(other, _), do: other

  defp insert(user, attrs, fields) do
    %Link{}
    |> Link.new_changeset(
      Map.merge(fields, %{
        user_id: user.id,
        share: if(attrs["share"] == "me", do: "me", else: "family"),
        color: present(attrs["color"]) || fields[:color] || "#5b7cfa"
      })
    )
    |> Repo.insert()
  end

  defp server(%{"provider" => "icloud"}), do: {:ok, "icloud", Application.get_env(:family, :icloud_url, "https://caldav.icloud.com/")}

  defp server(%{"provider" => "caldav", "url" => url}) when is_binary(url) do
    with {:ok, url} <- DAV.address(url), do: {:ok, "caldav", url}
  end

  defp server(%{"provider" => "caldav"}), do: {:error, "Put in the calendar server's address."}
  defp server(_), do: {:error, "Choose iCloud or another calendar server."}

  defp auth(attrs) do
    case {present(attrs["username"]), attrs["password"]} do
      {nil, _} -> {:error, "Put in the username."}
      {_, p} when not is_binary(p) or p == "" -> {:error, "Put in the password."}
      {user, password} -> {:ok, {user, String.trim(password)}}
    end
  end

  defp signed_in({:error, :unauthorized}, "icloud"),
    do:
      {:error,
       "Apple didn't accept that. Use your Apple ID's email and an app-specific password made at account.apple.com, not your usual password."}

  defp signed_in({:error, :unauthorized}, _), do: {:error, "The server didn't accept that username and password."}
  defp signed_in(other, _), do: other

  defp feed_name(data) do
    case Regex.run(~r/^X-WR-CALNAME:(.+)$/m, data) do
      [_, name] -> name |> String.trim() |> ICal.text() |> present()
      _ -> nil
    end
  end

  @doc "Changes a link's name, colour, who sees it, whether new events go there, or its password."
  def update(%User{} = user, id, attrs) do
    with %Link{} = link <- get(id) || {:error, :not_found},
         :ok <- if(may_manage?(user, link), do: :ok, else: {:error, :forbidden}),
         # Only whoever linked it decides who sees it.
         attrs = if(link.user_id == user.id, do: attrs, else: Map.delete(attrs, "share")),
         attrs = if(link.writable, do: attrs, else: Map.delete(attrs, "default")),
         {:ok, link} <- new_password(link, attrs["password"]),
         {:ok, updated} <- link |> Link.changeset(attrs) |> Repo.update() do
      if updated.default and not link.default, do: Repo.update_all(from(l in Link, where: l.id != ^updated.id), set: [default: false])
      if updated.share != link.share or updated.color != link.color or updated.name != link.name, do: Calendar.changed()
      {:ok, updated}
    end
  end

  defp new_password(link, password) when is_binary(password) and password != "" and link.provider == "caldav" do
    case DAV.ctag(link.url, {link.username, password}) do
      {:ok, _} ->
        link |> Ecto.Changeset.change(secret: Vault.seal(password), last_error: nil) |> Repo.update()

      {:error, :unauthorized} ->
        {:error, "That password wasn't accepted."}

      error ->
        error
    end
  end

  defp new_password(link, _), do: {:ok, link}

  @doc "Unlinks a calendar. Its events stay where they're kept; the copies here go."
  def remove(%User{} = user, id) do
    with %Link{} = link <- get(id) || {:error, :not_found},
         :ok <- if(may_manage?(user, link), do: :ok, else: {:error, :forbidden}) do
      Repo.delete_all(from e in Event, where: e.link_id == ^link.id)
      Repo.delete!(link)

      # Once none of an account's calendars is linked, it's let go.
      if link.account_id && not Repo.exists?(from l in Link, where: l.account_id == ^link.account_id) do
        with %Account{} = account <- Repo.get(Account, link.account_id), do: Connect.forget(account)
      end

      changed(link)
      :ok
    end
  end

  ## Copying linked calendars here

  @doc """
  Brings a link's copies here up to date, through the Sync process so two
  copies never run at once. `force: true` copies even if nothing seems to
  have changed.
  """
  def sync(%Link{id: id}, opts \\ []), do: Family.Calendar.Links.Sync.now(id, opts)

  @doc false
  # Run by the Sync process.
  def pull(%Link{} = link, opts) do
    result =
      try do
        copy(link, opts)
      rescue
        e ->
          Logger.error("Copying calendar #{link.id} failed: " <> Exception.format(:error, e, __STACKTRACE__))
          {:error, "Something went wrong copying this calendar. It'll try again shortly."}
      end

    now = DateTime.utc_now(:second)

    # Written without loading the link again, as it may have been unlinked
    # while it was being copied.
    status = from(l in Link, where: l.id == ^link.id)

    case result do
      {:ok, ctag, changes} ->
        Repo.update_all(status, set: [ctag: ctag, synced_on: Date.utc_today(), last_synced_at: now, last_error: nil])
        if changes, do: changed(link)
        :ok

      {:error, reason} ->
        message = error_text(reason, link)
        Repo.update_all(status, set: [last_error: message, last_synced_at: now])
        {:error, message}
    end
  end

  defp copy(%Link{provider: "caldav"} = link, opts) do
    with {:ok, auth} <- credentials(link),
         {:ok, ctag} <- DAV.ctag(link.url, auth) do
      if !opts[:force] and ctag && ctag == link.ctag and link.synced_on == Date.utc_today() do
        {:ok, ctag, false}
      else
        {from, to} = window()

        with {:ok, objects} <- DAV.events(link.url, auth, DateTime.new!(from, ~T[00:00:00]), DateTime.new!(Date.add(to, 1), ~T[00:00:00])) do
          rows =
            Enum.flat_map(objects, fn o ->
              o.data
              |> ICal.occurrences(from, to, zone())
              |> Enum.map(&Map.merge(&1, %{remote_href: o.href, remote_etag: o.etag}))
            end)

          {:ok, ctag, store(link, rows)}
        end
      end
    end
  end

  defp copy(%Link{provider: provider} = link, opts) when provider in @signed_in do
    with_token(link, fn token ->
      with {:ok, ctag} <- remote_ctag(provider, token, link.url) do
        if !opts[:force] and is_binary(ctag) and ctag == link.ctag and link.synced_on == Date.utc_today() do
          {:ok, ctag, false}
        else
          {from, to} = window()

          with {:ok, rows} <- api(provider).events(token, link.url, from, to, zone()) do
            {:ok, ctag, store(link, rows)}
          end
        end
      end
    end)
  end

  defp copy(%Link{provider: "ics"} = link, opts) do
    with {:ok, feed} <- if(opts[:feed], do: {:ok, opts[:feed]}, else: DAV.fetch(link.url)) do
      hash = :crypto.hash(:sha256, feed.data) |> Base.encode16(case: :lower) |> binary_part(0, 32)

      if !opts[:force] and hash == link.ctag and link.synced_on == Date.utc_today() do
        {:ok, hash, false}
      else
        {from, to} = window()
        rows = feed.data |> ICal.occurrences(from, to, zone()) |> Enum.map(&Map.merge(&1, %{remote_href: nil, remote_etag: nil}))
        {:ok, hash, store(link, rows)}
      end
    end
  end

  # Google says when a calendar last changed; Outlook's are copied in full each time.
  defp remote_ctag("google", token, calendar), do: Google.ctag(token, calendar)
  defp remote_ctag(_, _, _), do: {:ok, nil}

  defp api("google"), do: Google
  defp api("microsoft"), do: Microsoft

  # Runs `fun` with an access token for a link's account (or the account
  # itself), getting a new one once if the provider turns the old one down.
  defp with_token(%Link{account_id: nil}, _fun), do: {:error, :signed_out}

  defp with_token(%Link{account_id: id}, fun) do
    case Repo.get(Account, id) do
      nil -> {:error, :signed_out}
      account -> with_token(account, fun)
    end
  end

  defp with_token(%Account{} = account, fun) do
    with {:ok, token} <- Connect.token(account) do
      case fun.(token) do
        {:error, :unauthorized} ->
          Connect.stale(account)

          with {:ok, token} <- Connect.token(Repo.get(Account, account.id) || account) do
            case fun.(token) do
              {:error, :unauthorized} -> {:error, :signed_out}
              other -> other
            end
          end

        other ->
          other
      end
    end
  end

  defp window do
    today = Date.utc_today()
    {Date.add(today, -@behind_days), Date.add(today, @ahead_days)}
  end

  defp zone, do: Application.get_env(:family, :time_zone, "Europe/London")

  @fields [:title, :notes, :location, :emoji, :who, :all_day, :start_date, :end_date, :starts_at, :ends_at, :time_zone, :recurring] ++
            [:remote_uid, :remote_key, :remote_href, :remote_etag]

  # Makes the rows here match what the calendar has. True if anything changed.
  defp store(link, occurrences) do
    fresh =
      occurrences
      |> Enum.map(fn o -> o |> Map.put(:remote_uid, String.slice(o.uid, 0, 255)) |> Map.put(:remote_key, o.key) |> Map.take(@fields) end)
      |> Enum.group_by(&{&1.remote_href, &1.remote_uid, &1.remote_key})
      # A feed can give two different events the same UID; keep both.
      |> Enum.flat_map(fn {_, rows} ->
        rows |> Enum.with_index() |> Enum.map(fn {r, 0} -> r; {r, i} -> %{r | remote_key: "#{r.remote_key}##{i + 1}"} end)
      end)

    Repo.transaction(fn ->
      existing = Repo.all(from e in Event, where: e.link_id == ^link.id) |> Map.new(&{{&1.remote_href, &1.remote_uid, &1.remote_key}, &1})
      now = DateTime.utc_now(:second)
      source = link.provider

      {new, changed} =
        Enum.reduce(fresh, {[], 0}, fn row, {new, changed} ->
          case existing[{row.remote_href, row.remote_uid, row.remote_key}] do
            nil ->
              {[Map.merge(row, %{link_id: link.id, source: source, repeat: "none", inserted_at: now, updated_at: now}) | new], changed}

            event ->
              if Map.take(event, @fields) == row do
                {new, changed}
              else
                event |> Ecto.Changeset.change(row) |> Repo.update!()
                {new, changed + 1}
              end
          end
        end)

      new |> Enum.chunk_every(200) |> Enum.each(&Repo.insert_all(Event, &1))

      seen = MapSet.new(fresh, &{&1.remote_href, &1.remote_uid, &1.remote_key})
      gone = for {key, event} <- existing, not MapSet.member?(seen, key), do: event.id
      gone |> Enum.chunk_every(500) |> Enum.each(&Repo.delete_all(from e in Event, where: e.id in ^&1))

      new != [] or changed > 0 or gone != []
    end)
    |> elem(1)
  end

  ## Changes made here

  @doc "Saves a new event in a linked calendar, then copies it back here."
  def create_event(%Link{provider: provider} = link, %Event{} = event) when provider in @signed_in do
    case with_token(link, &api(provider).create(&1, link.url, event)) do
      {:ok, id} ->
        sync(link, force: true)
        {:ok, Repo.one(from e in Event, where: e.link_id == ^link.id and e.remote_href == ^id, order_by: [e.start_date, e.starts_at], limit: 1) || event}

      error ->
        write_error(error, link)
    end
  end

  def create_event(%Link{} = link, %Event{} = event) do
    uid = Ecto.UUID.generate()
    href = String.trim_trailing(link.url, "/") <> "/" <> uid <> ".ics"

    with {:ok, auth} <- credentials(link),
         {:ok, _etag} <- DAV.put(href, auth, ICal.build(event, uid), nil) do
      sync(link, force: true)
      {:ok, Repo.one(from e in Event, where: e.link_id == ^link.id and e.remote_href == ^href, order_by: [e.start_date, e.starts_at], limit: 1) || event}
    else
      error -> write_error(error, link)
    end
  end

  @doc "Changes an event in its linked calendar, keeping whatever else that calendar keeps on it."
  def update_event(%Link{provider: provider} = link, %Event{} = row, %Event{} = event) when provider in @signed_in do
    case with_token(link, &api(provider).update(&1, link.url, row.remote_href, event, row.remote_etag)) do
      :ok ->
        sync(link, force: true)
        {:ok, Repo.get(Event, row.id) || event}

      error ->
        write_error(error, link)
    end
  end

  def update_event(%Link{} = link, %Event{} = row, %Event{} = event) do
    with {:ok, auth} <- credentials(link),
         {:ok, %{data: data, etag: etag}} <- DAV.get(row.remote_href, auth),
         {:ok, text} <- ICal.patch(data, event),
         {:ok, _} <- DAV.put(row.remote_href, auth, text, etag || row.remote_etag) do
      sync(link, force: true)
      {:ok, Repo.get(Event, row.id) || event}
    else
      error -> write_error(error, link)
    end
  end

  @doc "Deletes an event from its linked calendar."
  def delete_event(%Link{provider: provider} = link, %Event{} = row) when provider in @signed_in do
    case with_token(link, &api(provider).delete(&1, link.url, row.remote_href)) do
      :ok ->
        Repo.delete_all(from e in Event, where: e.link_id == ^link.id and e.remote_href == ^row.remote_href)
        changed(link)
        :ok

      error ->
        write_error(error, link)
    end
  end

  def delete_event(%Link{} = link, %Event{} = row) do
    with {:ok, auth} <- credentials(link),
         :ok <- DAV.delete(row.remote_href, auth, nil) do
      Repo.delete_all(from e in Event, where: e.link_id == ^link.id and e.remote_href == ^row.remote_href)
      changed(link)
      :ok
    else
      error -> write_error(error, link)
    end
  end

  defp write_error({:error, reason}, link), do: {:error, error_text(reason, link)}

  defp error_text(:unauthorized, link),
    do: "#{link.name} wouldn't let the app in. Its password may have changed: put the new one in under Linked calendars, then Change."

  defp error_text(:signed_out, link),
    do: "#{link.name} needs signing in to #{Connect.name(link.provider)} again. Whoever linked it can do that under Linked calendars, then Change."

  defp error_text(:changed, link), do: "That event just changed in #{link.name}. Look again and try once more."
  defp error_text(:gone, link), do: "That event isn't in #{link.name} any more."
  defp error_text(:read_only, link), do: "#{link.name} can't be changed from here."
  defp error_text(:repeats, link), do: "This repeats in #{link.name}, so change it there."
  defp error_text(:no_password, link), do: "The saved password for #{link.name} can't be read. Put it in again under Linked calendars, then Change."
  defp error_text(reason, _) when is_binary(reason), do: reason
  defp error_text(reason, link) do
    Logger.warning("Linked calendar #{link.id}: #{inspect(reason) |> String.slice(0, 200)}")
    "#{link.name} couldn't be reached just now. Try again in a minute."
  end

  defp credentials(%Link{username: user, secret: secret}) do
    case Vault.open(secret) do
      {:ok, password} -> {:ok, {user, password}}
      :error -> {:error, :no_password}
    end
  end

  @doc "Tells whoever sees a link's events to fetch the calendar again."
  def changed(%Link{share: "me", user_id: id}), do: Family.Chat.notify_user(id, "calendar_changed", %{})
  def changed(_), do: Calendar.changed()

  defp present(nil), do: nil
  defp present(s) when is_binary(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))
  defp present(_), do: nil
end
