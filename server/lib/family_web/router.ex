defmodule FamilyWeb.Router do
  use FamilyWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug :whole_number_ids
    plug FamilyWeb.Auth, :load
  end

  pipeline :signed_in do
    plug FamilyWeb.Auth, :require
  end

  pipeline :password_chosen do
    plug FamilyWeb.Auth, :password_chosen
  end

  pipeline :browser do
    plug FamilyWeb.Auth, :load
  end

  scope "/api", FamilyWeb do
    pipe_through :api

    get "/setup", SessionController, :setup_status
    post "/setup", SessionController, :setup
    post "/session", SessionController, :create
    delete "/session", SessionController, :delete

    scope "/" do
      pipe_through :signed_in

      get "/me", MeController, :show
      post "/me/password", MeController, :password

      scope "/" do
        pipe_through :password_chosen

        patch "/me", MeController, :update
        delete "/me", MeController, :delete
        get "/export/me", ExportController, :me
        get "/export/family", ExportController, :family

        get "/people", PeopleController, :index
        post "/people", PeopleController, :create
        patch "/people/:id", PeopleController, :update
        put "/people/:id/permissions", PeopleController, :permissions
        post "/people/:id/reset", PeopleController, :reset
        delete "/people/:id", PeopleController, :delete
        patch "/bubbles/:id", PeopleController, :bubble
        get "/outbox", PeopleController, :outbox

        get "/rooms", RoomController, :index
        post "/rooms", RoomController, :create
        post "/rooms/direct/:user_id", RoomController, :direct
        patch "/rooms/:id", RoomController, :update
        get "/rooms/:id/messages", MessageController, :index
        post "/rooms/:id/messages", MessageController, :create
        post "/rooms/:id/read", MessageController, :read
        post "/rooms/:id/media", MediaController, :create
        delete "/messages/:id", MessageController, :delete
        post "/messages/:id/reactions", MessageController, :react

        get "/games", GameController, :index
        post "/rooms/:id/games", GameController, :create
        get "/games/:id", GameController, :show
        post "/games/:id/moves", GameController, :move
        post "/games/:id/join", GameController, :join
        post "/games/:id/remove", GameController, :remove

        get "/calendar", CalendarController, :index
        post "/calendar/events", CalendarController, :create
        patch "/calendar/events/:id", CalendarController, :update
        delete "/calendar/events/:id", CalendarController, :delete
        get "/calendar/links", CalendarController, :links
        post "/calendar/links/discover", CalendarController, :discover
        post "/calendar/links", CalendarController, :link
        patch "/calendar/links/:id", CalendarController, :update_link
        post "/calendar/links/:id/sync", CalendarController, :sync_link
        delete "/calendar/links/:id", CalendarController, :unlink
        get "/calendar/connect", CalendarController, :connect_status
        put "/calendar/connect/:provider", CalendarController, :connect_setup
        delete "/calendar/connect/:provider", CalendarController, :connect_clear
        post "/calendar/connect/:provider/start", CalendarController, :connect_start
        get "/calendar/accounts/:id/calendars", CalendarController, :account_calendars

        get "/tasks", TaskController, :index
        post "/tasks", TaskController, :create
        patch "/tasks/:id", TaskController, :update
        delete "/tasks/:id", TaskController, :delete
        post "/tasks/:id/done", TaskController, :done
        post "/tasks/:id/status", TaskController, :status

        get "/push", PushController, :show
        post "/push/subscriptions", PushController, :subscribe
        delete "/push/subscriptions", PushController, :unsubscribe
        delete "/push/devices/:id", PushController, :remove_device
        post "/push/test", PushController, :test
        put "/rooms/:id/muted", PushController, :mute

        post "/friends", FriendController, :ask
        post "/friends/:id/yes", FriendController, :approve
        delete "/friends/:id", FriendController, :remove

        get "/rewards", RewardController, :index
        post "/rewards/:user_id/paid", RewardController, :pay
        delete "/payouts/:id", RewardController, :unpay
        post "/goals", RewardController, :create_goal
        patch "/goals/:id", RewardController, :update_goal
        delete "/goals/:id", RewardController, :delete_goal
      end
    end
  end

  # Everything in an address is found by its number, so anything else in
  # that place isn't there (rather than tripping up the controller).
  defp whole_number_ids(conn, _opts) do
    if Enum.all?(conn.path_params, fn {key, value} -> key not in ~w(id user_id) or value =~ ~r/^\d{1,15}$/ end) do
      conn
    else
      conn |> put_status(404) |> json(%{error: "That isn't here any more."}) |> halt()
    end
  end

  scope "/", FamilyWeb do
    pipe_through :browser

    get "/media/:key", MediaController, :show
    # Google and Microsoft send people back here after signing in.
    get "/calendar-connect/:provider", CalendarConnectController, :back
    get "/*path", PageController, :index
  end
end
