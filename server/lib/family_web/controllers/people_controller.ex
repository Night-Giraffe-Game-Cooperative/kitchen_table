defmodule FamilyWeb.PeopleController do
  use FamilyWeb, :controller
  alias Family.{Accounts, Permissions, Mailer}

  def index(conn, _) do
    me = conn.assigns.current_user
    people = Accounts.list_users()

    # Admins see everyone's details; grown-ups see the details of the kids they look after.
    shown =
      Enum.map(people, fn p ->
        cond do
          Permissions.can?(me, :manage_people) -> Present.person_admin(p)
          Accounts.looks_after?(me, p) -> Present.person_admin(p)
          p.id == me.id -> Present.person_admin(p)
          true -> Present.person(p)
        end
      end)

    online = FamilyWeb.Presence.list("family:presence") |> Map.keys()
    bubbles = Enum.map(Accounts.list_bubbles(), &Present.bubble/1)
    friendships = Enum.map(Family.Contacts.friendships_for(me), &Present.friendship/1)

    json(conn, %{
      people: shown,
      bubbles: bubbles,
      friendships: friendships,
      online: online,
      permissions: Permissions.all(),
      features: Permissions.features()
    })
  end

  def create(conn, params) do
    attrs = Map.take(params, ~w(name email role colour avatar bubble_id bubble_name bubble_emoji))

    with {:ok, user, otp} <- Accounts.invite(conn.assigns.current_user, attrs) do
      json(conn, %{person: Present.person_admin(user), one_time_password: otp})
    end
  end

  def update(conn, %{"id" => id} = params) do
    with %{} = user <- Accounts.get_user(id),
         {:ok, user} <-
           Accounts.admin_update(conn.assigns.current_user, user, Map.take(params, ~w(name email role colour avatar active bubble_id))) do
      json(conn, %{person: Present.person_admin(user)})
    end
  end

  def permissions(conn, %{"id" => id} = params) do
    with %{} = user <- Accounts.get_user(id),
         {:ok, user} <-
           Accounts.set_permissions(conn.assigns.current_user, user, params["overrides"] || %{}, params["quiet_hours"]) do
      json(conn, %{person: Present.person_admin(user)})
    end
  end

  def reset(conn, %{"id" => id}) do
    with %{} = user <- Accounts.get_user(id),
         {:ok, user, otp} <- Accounts.reset_password(conn.assigns.current_user, user) do
      json(conn, %{person: Present.person_admin(user), one_time_password: otp})
    end
  end

  def delete(conn, %{"id" => id} = params) do
    with %{} = user <- Accounts.get_user(id),
         :ok <- Family.Erase.person(conn.assigns.current_user, user, params["confirm"]) do
      json(conn, %{ok: true})
    end
  end

  def bubble(conn, %{"id" => id} = params) do
    admin = conn.assigns.current_user

    with %{} = bubble <- Accounts.get_bubble(id),
         {:ok, bubble} <- Accounts.update_bubble(admin, bubble, Map.take(params, ~w(name emoji features))),
         :ok <- if(Map.has_key?(params, "relative_ids"), do: Family.Contacts.set_relatives(admin, bubble, params["relative_ids"]), else: :ok) do
      json(conn, %{bubble: Present.bubble(bubble)})
    end
  end

  def outbox(conn, _) do
    if Permissions.can?(conn.assigns.current_user, :manage_people) do
      emails =
        Enum.map(Mailer.outbox(), fn e ->
          %{id: e.id, to: e.to, subject: e.subject, body: e.body, sent_at: e.inserted_at}
        end)

      json(conn, %{emails: emails})
    else
      {:error, :forbidden}
    end
  end
end
