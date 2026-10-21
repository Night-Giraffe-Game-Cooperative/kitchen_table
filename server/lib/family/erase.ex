defmodule Family.Erase do
  @moduledoc """
  Removing someone for good. Their account goes, and with it what was only
  theirs: the messages they wrote (each leaves a "Message deleted" so replies
  still make sense), the photos and doodles they shared, their reactions,
  ticks, rewards and goals, the calendars they linked, their emails in the
  outbox, and their sign-ins and notification devices.

  What the family shares stays, without their name on it: events they added,
  games they played, group chats they made, and the other side of their
  one-to-one chats.

  Grown-ups and admins can remove themselves (kids ask a grown-up), and
  admins can remove anyone. The family always keeps an admin, and a family
  with kids always keeps a grown-up.
  """

  import Ecto.Query
  alias Family.{Accounts, Chat, Repo}
  alias Family.Accounts.{Bubble, User}
  alias Family.Calendar.Event
  alias Family.Chat.{Media, Member, Message}
  alias Family.Mailer.Email
  alias Family.Tasks.Task

  @doc "Someone removing their own account, checked with their password."
  def myself(%User{role: "kid"}, _password), do: {:error, "Ask your guardian to delete your account."}

  def myself(%User{} = user, password) do
    if Accounts.Passwords.verify(to_string(password), user.password_hash),
      do: erase(user),
      else: {:error, "That password isn't right."}
  end

  @doc "An admin removing someone else, who types their name to be sure."
  def person(%User{} = admin, %User{} = user, typed) do
    cond do
      not Family.Permissions.can?(admin, :manage_people) -> {:error, :forbidden}
      admin.id == user.id -> {:error, "Delete your own account from Me."}
      String.trim(to_string(typed)) != user.name -> {:error, "Type #{user.name} to be sure."}
      true -> erase(user)
    end
  end

  defp erase(%User{} = user) do
    with :ok <- keeps_an_admin(user),
         :ok <- keeps_a_grown_up(user) do
      rooms = Repo.all(from m in Member, where: m.user_id == ^user.id, select: m.room_id)
      media = Repo.all(from m in Media, where: m.user_id == ^user.id)
      now = DateTime.utc_now(:second)

      {:ok, _} =
        Repo.transaction(fn ->
          Repo.update_all(from(m in Message, where: m.user_id == ^user.id and m.kind in ~w(text photo doodle)),
            set: [deleted_at: now, body: nil, media_id: nil, data: nil]
          )

          Repo.delete_all(from m in Media, where: m.user_id == ^user.id)

          for task <- Repo.all(from t in Task), user.id in task.user_ids do
            case List.delete(task.user_ids, user.id) do
              [] -> Repo.delete!(task)
              left -> task |> Ecto.Changeset.change(user_ids: left) |> Repo.update!()
            end
          end

          for event <- Repo.all(from e in Event, where: is_nil(e.link_id)), user.id in (event.who || []) do
            event |> Ecto.Changeset.change(who: List.delete(event.who, user.id)) |> Repo.update!()
          end

          Repo.delete_all(from e in Email, where: e.to == ^user.email)
          Repo.delete!(user)

          # A family of friends or cousins with nobody left in it goes too.
          with id when not is_nil(id) <- user.bubble_id,
               %Bubble{home: false} = bubble <- Repo.get(Bubble, id),
               false <- Repo.exists?(from u in User, where: u.bubble_id == ^id) do
            Repo.delete!(bubble)
          end
        end)

      for m <- media, do: File.rm(Chat.media_path(m.key, m.content_type))

      # Their devices sign out now, and everyone else's screens catch up.
      FamilyWeb.Endpoint.broadcast("user_socket:#{user.id}", "disconnect", %{})
      FamilyWeb.Endpoint.broadcast("family:presence", "people_changed", %{id: nil})
      for room_id <- rooms, member <- Chat.member_ids(room_id), do: Chat.notify_user(member, "rooms_changed", %{})
      for room_id <- rooms, do: FamilyWeb.Endpoint.broadcast("room:#{room_id}", "messages:reload", %{})
      :ok
    end
  end

  defp keeps_an_admin(%User{role: "admin", id: id}) do
    if Repo.exists?(from u in User, where: u.role == "admin" and u.active and u.id != ^id),
      do: :ok,
      else: {:error, "The family needs an admin. Make someone else an admin first."}
  end

  defp keeps_an_admin(_), do: :ok

  defp keeps_a_grown_up(%User{role: role, bubble_id: bubble_id, id: id}) when role in ~w(admin grownup) and not is_nil(bubble_id) do
    kids = Repo.exists?(from u in User, where: u.bubble_id == ^bubble_id and u.role == "kid")
    others = Repo.exists?(from u in User, where: u.bubble_id == ^bubble_id and u.role in ~w(admin grownup) and u.id != ^id)

    if kids and not others,
      do: {:error, "The kids in this family need a guardian. Move them to another family or delete their accounts first."},
      else: :ok
  end

  defp keeps_a_grown_up(_), do: :ok
end
