defmodule Family.Accounts do
  @moduledoc """
  The people in the family: the first admin, invitations with one-time
  passwords, signing in, changing passwords and the permissions admins grant.

  Everyone belongs to a family bubble (one household). The home bubble runs
  Kitchen Table; friends and cousins come in bubbles of their own, each with
  a grown-up, and a bubble's grown-ups look after that bubble's kids. Admins
  only ever come from the home bubble, and they choose which features each
  other bubble has.
  """

  import Ecto.Query
  alias Family.{Repo, Permissions, Mailer, Chat}
  alias Family.Accounts.{User, Bubble, Token, Passwords, OneTimePassword}

  @session_days 120

  ## People

  def setup_needed?, do: not Repo.exists?(User)

  def get_user(id), do: Repo.get(User, id)
  def get_user!(id), do: Repo.get!(User, id)

  def list_users do
    User |> order_by([u], desc: u.active, asc: u.name) |> Repo.all()
  end

  ## Family bubbles

  def list_bubbles, do: Bubble |> order_by([b], desc: b.home, asc: b.name) |> Repo.all()

  def home_bubble, do: Repo.one(from b in Bubble, where: b.home, limit: 1)

  def get_bubble(id), do: Repo.get(Bubble, id)

  @doc """
  Whether someone looks after a kid: admins look after every kid, and a
  grown-up allowed to look after kids looks after the kids in their own bubble.
  """
  def looks_after?(%User{} = actor, %User{role: "kid"} = kid) do
    Permissions.can?(actor, :manage_people) or
      (actor.role == "grownup" and not is_nil(actor.bubble_id) and actor.bubble_id == kid.bubble_id and
         Permissions.can?(actor, :manage_kids))
  end

  def looks_after?(_, _), do: false

  @doc "An admin renames a bubble, changes its picture or chooses its features."
  def update_bubble(%User{} = admin, %Bubble{} = bubble, attrs) do
    with :ok <- authorise(admin, :manage_people),
         {:ok, bubble} <- bubble |> Bubble.changeset(attrs) |> Repo.update() do
      FamilyWeb.Endpoint.broadcast("family:presence", "people_changed", %{id: nil})
      {:ok, bubble}
    end
  end

  # Which bubble someone joins: one that's here, a new one by name, or home.
  defp choose_bubble(%{"bubble_id" => id}) when id not in [nil, ""] do
    with {id, ""} <- Integer.parse(to_string(id)),
         %Bubble{} = bubble <- get_bubble(id) do
      {:ok, bubble}
    else
      _ -> {:error, "Choose which family they're in."}
    end
  end

  defp choose_bubble(%{"bubble_name" => name} = attrs) when is_binary(name) do
    %Bubble{} |> Bubble.changeset(%{"name" => name, "emoji" => attrs["bubble_emoji"] || "🏡"}) |> Repo.insert()
  end

  defp choose_bubble(_) do
    case home_bubble() do
      nil -> {:error, "Choose which family they're in."}
      bubble -> {:ok, bubble}
    end
  end

  # A kid only comes in with a grown-up from their own family to look after them.
  defp someone_looks_after("kid", %Bubble{} = bubble) do
    if Repo.exists?(from u in User, where: u.bubble_id == ^bubble.id and u.active and u.role in ["admin", "grownup"]),
      do: :ok,
      else: {:error, "Add a guardian from #{bubble.name} first: a grown-up in that family who looks after its kids."}
  end

  defp someone_looks_after(_, _), do: :ok

  # Admins run Kitchen Table for the home family, so they never sit in another bubble.
  defp admin_at_home("admin", %Bubble{home: false}),
    do: {:error, "Admins come from the home family. People in other families can be grown-ups or kids."}

  defp admin_at_home(_, _), do: :ok

  @doc "Creates the first admin, only while nobody exists yet."
  def create_first_admin(attrs) do
    Repo.transaction(fn ->
      if not setup_needed?(), do: Repo.rollback(:already_set_up)

      with :ok <- Passwords.validate_new(attrs["password"]),
           {:ok, user} <-
             %User{role: "admin", must_change_password: false}
             |> User.invite_changeset(Map.put(attrs, "role", "admin"))
             |> Ecto.Changeset.put_change(:password_hash, Passwords.hash(attrs["password"]))
             |> Repo.insert() do
        bubble = Repo.insert!(%Bubble{name: "#{user.name}'s family", emoji: "🏡", home: true})
        user = user |> Ecto.Changeset.change(bubble_id: bubble.id) |> Repo.update!()
        Chat.ensure_family_room(user)
        user
      else
        {:error, %Ecto.Changeset{} = cs} -> Repo.rollback(cs)
        {:error, message} -> Repo.rollback({:password, message})
      end
    end)
  end

  @doc """
  An admin adds someone by email. They get a one-time password by email (or in
  the outbox), and must choose their own password when they first sign in.
  Returns the user and the one-time password so the admin can pass it on too.

  They join a family bubble: `bubble_id`, a new one named by `bubble_name`,
  or the home bubble. Only the home bubble's people join the whole-family chat.
  """
  def invite(%User{} = admin, attrs) do
    with :ok <- authorise(admin, :manage_people) do
      otp = OneTimePassword.generate()

      changeset =
        %User{must_change_password: true, otp_expires_at: otp_expiry()}
        |> User.invite_changeset(attrs)
        |> Ecto.Changeset.put_change(:password_hash, Passwords.hash(otp))
        |> Ecto.Changeset.put_change(:colour, attrs["colour"] || Enum.random(User.colours()))

      Repo.transaction(fn ->
        with {:ok, bubble} <- choose_bubble(attrs),
             :ok <- admin_at_home(attrs["role"], bubble),
             :ok <- someone_looks_after(attrs["role"], bubble),
             {:ok, user} <- changeset |> Ecto.Changeset.put_change(:bubble_id, bubble.id) |> Repo.insert() do
          if bubble.home do
            room = Chat.add_to_family_room(user)
            Chat.notify_members(room.id, "rooms_changed", %{})
          end

          send_invitation(admin, user, otp)
          broadcast_person(user)
          user
        else
          {:error, reason} -> Repo.rollback(reason)
        end
      end)
      |> case do
        {:ok, user} -> {:ok, user, otp}
        error -> error
      end
    end
  end

  @doc "Gives someone a new one-time password, for a forgotten password."
  def reset_password(%User{} = admin, %User{} = user) do
    with :ok <- authorise(admin, :manage_people) do
      otp = OneTimePassword.generate()

      {:ok, user} =
        user
        |> Ecto.Changeset.change(
          password_hash: Passwords.hash(otp),
          must_change_password: true,
          otp_expires_at: otp_expiry()
        )
        |> Repo.update()

      delete_tokens(user)
      send_reset(admin, user, otp)
      {:ok, user, otp}
    end
  end

  @doc """
  An admin changes someone's name, email, role, colour, family bubble or
  whether they can sign in.
  """
  def admin_update(%User{} = admin, %User{} = user, attrs) do
    with :ok <- authorise(admin, :manage_people),
         :ok <- keep_an_admin(user, attrs),
         {:ok, moving_to} <- moving_to(user, attrs),
         :ok <- admin_at_home(attrs["role"] || user.role, moving_to || (user.bubble_id && get_bubble(user.bubble_id))) do
      changeset = User.admin_changeset(user, attrs)
      changeset = if moving_to, do: Ecto.Changeset.put_change(changeset, :bubble_id, moving_to.id), else: changeset

      with {:ok, updated} <- Repo.update(changeset) do
        if moving_to, do: moved(user, updated, moving_to)
        if not updated.active, do: delete_tokens(updated)
        broadcast_person(updated)
        {:ok, updated}
      end
    end
  end

  # The bubble someone is moving to, if they are.
  defp moving_to(%User{} = user, %{"bubble_id" => id} = attrs) when id not in [nil, ""] do
    with {:ok, bubble} <- choose_bubble(%{"bubble_id" => id}) do
      if bubble.id == user.bubble_id do
        {:ok, nil}
      else
        with :ok <- someone_looks_after(attrs["role"] || user.role, bubble), do: {:ok, bubble}
      end
    end
  end

  defp moving_to(_, _), do: {:ok, nil}

  # Only the home bubble is in the whole-family chat. A bubble left empty goes.
  defp moved(before, %User{} = user, %Bubble{} = bubble) do
    if bubble.home, do: Chat.add_to_family_room(user), else: Chat.remove_from_family_room(user)
    Chat.notify_user(user.id, "rooms_changed", %{})

    with id when not is_nil(id) <- before.bubble_id,
         %Bubble{home: false} = old <- get_bubble(id),
         false <- Repo.exists?(from u in User, where: u.bubble_id == ^id) do
      Repo.delete!(old)
    end
  end

  @doc """
  Switches single permissions on or off, and sets quiet hours. Admins can do
  this for anyone who isn't an admin; grown-ups allowed to manage kids can do
  it for the kids in their own family bubble.
  """
  def set_permissions(%User{} = actor, %User{} = user, overrides, quiet_hours) do
    cond do
      user.role == "admin" ->
        {:error, :forbidden}

      not (Permissions.can?(actor, :manage_people) or looks_after?(actor, user)) ->
        {:error, :forbidden}

      not Permissions.valid_quiet_hours?(quiet_hours) ->
        {:error, :invalid_quiet_hours}

      true ->
        {:ok, updated} =
          user
          |> Ecto.Changeset.change(
            permissions: Permissions.clean_overrides(overrides),
            quiet_hours: quiet_hours
          )
          |> Repo.update()

        broadcast_person(updated)
        {:ok, updated}
    end
  end

  def update_profile(%User{} = user, attrs) do
    with {:ok, user} <- user |> User.profile_changeset(attrs) |> Repo.update() do
      broadcast_person(user)
      {:ok, user}
    end
  end

  defp keep_an_admin(%User{role: "admin"} = user, attrs) do
    demoting = Map.has_key?(attrs, "role") and attrs["role"] != "admin"
    deactivating = Map.get(attrs, "active") in [false, "false"]

    other_admins =
      Repo.aggregate(
        from(u in User, where: u.role == "admin" and u.active and u.id != ^user.id),
        :count
      )

    if (demoting or deactivating) and other_admins == 0,
      do: {:error, :last_admin},
      else: :ok
  end

  defp keep_an_admin(_, _), do: :ok

  defp authorise(user, permission) do
    if Permissions.can?(user, permission), do: :ok, else: {:error, :forbidden}
  end

  defp otp_expiry do
    DateTime.utc_now()
    |> DateTime.add(OneTimePassword.lifetime_days() * 86_400)
    |> DateTime.truncate(:second)
  end

  defp broadcast_person(user) do
    FamilyWeb.Endpoint.broadcast("family:presence", "people_changed", %{id: user.id})
  end

  ## Signing in

  @doc """
  Checks an email and password. A one-time password signs in only before it
  expires, and the session it makes can do nothing but change the password.
  """
  def authenticate(email, password) do
    email = email |> to_string() |> String.trim() |> String.downcase()
    user = Repo.get_by(User, email: email)

    cond do
      is_nil(user) ->
        Passwords.no_user_verify()
        {:error, :invalid}

      not Passwords.verify(to_string(password), user.password_hash) ->
        {:error, :invalid}

      not user.active ->
        {:error, :inactive}

      user.must_change_password and otp_expired?(user) ->
        {:error, :otp_expired}

      true ->
        {:ok, user}
    end
  end

  defp otp_expired?(%User{otp_expires_at: nil}), do: false

  defp otp_expired?(%User{otp_expires_at: at}),
    do: DateTime.compare(DateTime.utc_now(), at) == :gt

  def change_password(%User{} = user, current, new) do
    cond do
      not Passwords.verify(to_string(current), user.password_hash) ->
        {:error, "Your current password isn't right."}

      current == new ->
        {:error, "Choose a password that's different from the old one."}

      true ->
        with :ok <- Passwords.validate_new(new),
             {:ok, user} <-
               user
               |> Ecto.Changeset.change(password_hash: Passwords.hash(new), must_change_password: false, otp_expires_at: nil)
               |> Repo.update() do
          # So the family list stops saying they haven't signed in yet.
          broadcast_person(user)
          {:ok, user}
        end
    end
  end

  ## Sessions

  def create_session(%User{} = user) do
    token = :crypto.strong_rand_bytes(32)

    Repo.insert!(%Token{
      user_id: user.id,
      token_hash: :crypto.hash(:sha256, token),
      context: "session",
      last_used_at: DateTime.utc_now() |> DateTime.truncate(:second)
    })

    Base.url_encode64(token, padding: false)
  end

  def user_for_session(token) when is_binary(token) do
    with {:ok, raw} <- Base.url_decode64(token, padding: false) do
      hash = :crypto.hash(:sha256, raw)
      cutoff = session_cutoff()

      query =
        from t in Token,
          join: u in assoc(t, :user),
          where: t.token_hash == ^hash and t.context == "session" and t.last_used_at > ^cutoff,
          where: u.active,
          select: {t, u}

      case Repo.one(query) do
        {token, user} ->
          touch(token)
          user

        nil ->
          nil
      end
    else
      _ -> nil
    end
  end

  def user_for_session(_), do: nil

  # Sliding expiry, written at most once an hour.
  defp touch(%Token{last_used_at: last} = token) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    if DateTime.diff(now, last) > 3600 do
      token |> Ecto.Changeset.change(last_used_at: now) |> Repo.update()
    end
  end

  @doc "The stored row behind a session, for things that last only as long as it does."
  def session_id(token) when is_binary(token) do
    with {:ok, raw} <- Base.url_decode64(token, padding: false) do
      Repo.one(from t in Token, where: t.token_hash == ^:crypto.hash(:sha256, raw) and t.context == "session", select: t.id)
    else
      _ -> nil
    end
  end

  def session_id(_), do: nil

  @doc "Sessions last used before this have expired."
  def session_cutoff, do: DateTime.add(DateTime.utc_now(), -@session_days * 86_400)

  def delete_session(token) when is_binary(token) do
    with {:ok, raw} <- Base.url_decode64(token, padding: false) do
      Repo.delete_all(from t in Token, where: t.token_hash == ^:crypto.hash(:sha256, raw))
    end

    :ok
  end

  def delete_session(_), do: :ok

  def delete_tokens(%User{id: id}) do
    Repo.delete_all(from t in Token, where: t.user_id == ^id)
    FamilyWeb.Endpoint.broadcast("user_socket:#{id}", "disconnect", %{})
    :ok
  end

  def mark_seen(%User{} = user) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    Repo.update_all(from(u in User, where: u.id == ^user.id), set: [last_seen_at: now])
  end

  ## Emails

  defp send_invitation(admin, user, otp) do
    app = Application.get_env(:family, :app_name)

    Mailer.deliver(user.email, "#{admin.name} has added you to #{app}", """
    Hello #{user.name},

    #{admin.name} has added you to #{app}, the family's own place for messages,
    photos, doodles and games.

    Open #{FamilyWeb.Endpoint.url()} and sign in with this email address and
    this one-time password:

        #{otp}

    It works for #{OneTimePassword.lifetime_days()} days. When you sign in you'll choose
    your own password.
    """)
  end

  defp send_reset(admin, user, otp) do
    app = Application.get_env(:family, :app_name)

    Mailer.deliver(user.email, "A new one-time password for #{app}", """
    Hello #{user.name},

    #{admin.name} has given you a new one-time password for #{app}. Open
    #{FamilyWeb.Endpoint.url()} and sign in with it:

        #{otp}

    It works for #{OneTimePassword.lifetime_days()} days. When you sign in you'll choose
    a new password of your own.
    """)
  end
end
