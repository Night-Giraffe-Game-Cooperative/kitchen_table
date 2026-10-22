defmodule FamilyWeb.CalendarController do
  use FamilyWeb, :controller
  alias Family.Calendar
  alias Family.Calendar.{Connect, Links}
  alias FamilyWeb.CalendarConnectController

  def index(conn, params) do
    user = conn.assigns.current_user

    with {:ok, from, to} <- range(params) do
      json(conn, %{
        events: Enum.map(Calendar.list(user, from, to), &Present.event/1),
        links: Enum.map(Links.visible(user), &Present.link(&1, user)),
        can_see: Calendar.can_see?(user),
        can_edit: Calendar.can_edit?(user),
        can_link: Links.can_link?(user)
      })
    end
  end

  def create(conn, params) do
    with {:ok, event} <- Calendar.create(conn.assigns.current_user, params), do: json(conn, %{event: Present.event(event)})
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, event} <- Calendar.update(conn.assigns.current_user, String.to_integer(id), params),
         do: json(conn, %{event: Present.event(event)})
  end

  def delete(conn, %{"id" => id}) do
    with :ok <- Calendar.delete(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end

  # Linked calendars.

  def links(conn, _) do
    user = conn.assigns.current_user
    json(conn, %{links: Enum.map(Links.visible(user), &Present.link(&1, user)), can_link: Links.can_link?(user)})
  end

  def discover(conn, params) do
    with {:ok, calendars} <- Links.discover(conn.assigns.current_user, params) do
      json(conn, %{calendars: Enum.map(calendars, &Map.take(&1, [:url, :name, :color, :writable]))})
    end
  end

  def link(conn, params) do
    user = conn.assigns.current_user
    with {:ok, links} <- Links.add(user, params), do: json(conn, %{links: Enum.map(links, &Present.link(&1, user))})
  end

  def update_link(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    with {:ok, link} <- Links.update(user, String.to_integer(id), Map.take(params, ~w(name color share default password))),
         do: json(conn, %{link: Present.link(link, user)})
  end

  def sync_link(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with %Family.Calendar.Link{} = link <- Links.get(String.to_integer(id)) || {:error, :not_found},
         true <- link in Links.visible(user) || {:error, :not_found},
         :ok <- Links.sync(link, force: true) do
      json(conn, %{link: Present.link(Links.get(link.id), user)})
    end
  end

  def unlink(conn, %{"id" => id}) do
    with :ok <- Links.remove(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end

  # Signing in to Google or Microsoft to link their calendars.

  def connect_status(conn, _) do
    json(conn, %{providers: Connect.status(conn.assigns.current_user, CalendarConnectController.site(conn))})
  end

  def connect_setup(conn, %{"provider" => provider} = params) do
    with {:ok, provider} <- provider(provider),
         :ok <- Connect.setup(conn.assigns.current_user, provider, params),
         do: connect_status(conn, params)
  end

  def connect_clear(conn, %{"provider" => provider} = params) do
    with {:ok, provider} <- provider(provider),
         :ok <- Connect.clear(conn.assigns.current_user, provider),
         do: connect_status(conn, params)
  end

  def connect_start(conn, %{"provider" => provider} = params) do
    with {:ok, provider} <- provider(provider),
         {:ok, url} <- Connect.start(conn.assigns.current_user, provider, CalendarConnectController.site(conn), params["account"]),
         do: json(conn, %{url: url})
  end

  def account_calendars(conn, %{"id" => id}) do
    with {:ok, account, calendars} <- Links.account_calendars(conn.assigns.current_user, id) do
      json(conn, %{
        account: %{id: account.id, provider: account.provider, email: account.email},
        calendars: Enum.map(calendars, &Map.take(&1, [:url, :name, :color, :writable]))
      })
    end
  end

  defp provider(provider), do: if(provider in Connect.providers(), do: {:ok, provider}, else: {:error, :not_found})

  defp range(%{"from" => from, "to" => to}) do
    with {:ok, from} <- Date.from_iso8601(from),
         {:ok, to} <- Date.from_iso8601(to),
         true <- Date.diff(to, from) in 0..400 do
      {:ok, from, to}
    else
      _ -> {:error, "Ask for up to a year of days, from and to."}
    end
  end

  defp range(_), do: {:error, "Ask for up to a year of days, from and to."}
end
