defmodule Family.Calendar.Connect do
  @moduledoc """
  Signing in to Google or Microsoft from Linked calendars, so their
  calendars go both ways (OAuth 2.0, with PKCE).

  Each needs an app registered with it by whoever runs this server
  (docs/calendar-sign-in.md says how). Its client ID and secret come from
  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or MICROSOFT_...) when the
  server starts with them, or else from an admin pasting them in under
  Linked calendars, where the secret is sealed like a calendar password.

  Signing in gives an Account, kept for the person who signed in; the
  calendars they pick from it become links that share it.
  """

  import Ecto.Query
  require Logger
  alias Family.{HTTP, Permissions, Repo, Settings}
  alias Family.Accounts.User
  alias Family.Calendar
  alias Family.Calendar.{Account, Link, Vault}

  @providers ~w(google microsoft)
  @salt "calendar sign-in"
  # Long enough to sign in, pick an account and say yes; too short to keep.
  @state_age 20 * 60

  @urls %{
    google_accounts: "https://accounts.google.com",
    google_oauth: "https://oauth2.googleapis.com",
    google_api: "https://www.googleapis.com/calendar/v3",
    microsoft_login: "https://login.microsoftonline.com",
    microsoft_graph: "https://graph.microsoft.com/v1.0"
  }

  def providers, do: @providers

  def name("google"), do: "Google"
  def name("microsoft"), do: "Microsoft"

  @doc "Where each provider is reached. Tests and the browser tests send these to a stand-in."
  def url(key), do: Application.get_env(:family, :connect_urls, %{})[key] || Map.fetch!(@urls, key)

  ## The app registered with each provider

  @doc """
  The client ID and secret for a provider, and where they came from:
  `:server` (its settings) or `:app` (an admin). `:none` until one is set.
  """
  def client(provider) when provider in @providers do
    case Application.get_env(:family, :connect_clients, %{})[provider] do
      {id, secret} when is_binary(id) and id != "" and is_binary(secret) and secret != "" ->
        {:ok, id, secret, :server}

      _ ->
        with id when is_binary(id) <- Settings.get("#{provider}_client_id"),
             sealed when is_binary(sealed) <- Settings.get("#{provider}_client_secret"),
             {:ok, raw} <- Base.decode64(sealed),
             {:ok, secret} <- Vault.open(raw) do
          {:ok, id, secret, :app}
        else
          _ -> :none
        end
    end
  end

  def ready?(provider), do: match?({:ok, _, _, _}, client(provider))

  @doc """
  How signing in to each provider is set up, as someone sees it. Admins
  also get what to give the provider when registering the app.
  """
  def status(%User{} = user, site) do
    admin = Permissions.can?(user, :manage_people)

    for provider <- @providers do
      client = client(provider)
      base = %{provider: provider, ready: match?({:ok, _, _, _}, client)}

      if admin do
        Map.merge(base, %{
          can_setup: not match?({:ok, _, _, :server}, client),
          redirect_uri: redirect_uri(site, provider),
          client_id: with({:ok, id, _, _} <- client, do: id, else: (_ -> nil))
        })
      else
        Map.put(base, :can_setup, false)
      end
    end
  end

  @doc """
  An admin saves the client ID and secret of the app registered with a
  provider. Leaving the secret empty keeps the one already saved.
  """
  def setup(%User{} = user, provider, attrs) when provider in @providers do
    id = present(attrs["client_id"])
    secret = present(attrs["client_secret"])

    cond do
      not Permissions.can?(user, :manage_people) -> {:error, :forbidden}
      match?({:ok, _, _, :server}, client(provider)) -> {:error, "This server's own settings say how to sign in to #{name(provider)}."}
      is_nil(id) -> {:error, "Put in the client ID."}
      not client_id?(provider, id) -> {:error, client_id_hint(provider)}
      is_nil(secret) and is_nil(Settings.get("#{provider}_client_secret")) -> {:error, "Put in the client secret."}
      true ->
        Settings.put("#{provider}_client_id", id)
        if secret, do: Settings.put("#{provider}_client_secret", Base.encode64(Vault.seal(secret)))
        :ok
    end
  end

  @doc "An admin stops signing in to a provider. Calendars already linked stop being copied until it's set up again."
  def clear(%User{} = user, provider) when provider in @providers do
    if Permissions.can?(user, :manage_people) do
      Settings.delete("#{provider}_client_id")
      Settings.delete("#{provider}_client_secret")
      :ok
    else
      {:error, :forbidden}
    end
  end

  # Catches a secret or the wrong ID pasted into the ID's box.
  defp client_id?("google", id), do: String.ends_with?(id, ".apps.googleusercontent.com")
  defp client_id?("microsoft", id), do: id =~ ~r/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  defp client_id_hint("google"), do: "Google's client ID ends in .apps.googleusercontent.com."
  defp client_id_hint("microsoft"), do: "Microsoft's client ID is the Application (client) ID, like 0a1b2c3d-…, not the secret."

  @doc "Where the provider sends someone back to: it has to be given exactly this when the app is registered."
  def redirect_uri(site, provider), do: String.trim_trailing(site, "/") <> "/calendar-connect/" <> provider

  ## Signing in

  @doc """
  Where to send someone to sign in. `account_id` signs in again to an
  account they already have, when it has stopped letting the app in.
  """
  def start(%User{} = user, provider, site, account_id \\ nil) when provider in @providers do
    with :ok <- if(Calendar.can_edit?(user), do: :ok, else: {:error, :forbidden}),
         {:ok, client_id, _, _} <- ready(provider),
         {:ok, account} <- own(user, account_id, provider) do
      verifier = 32 |> :crypto.strong_rand_bytes() |> Base.url_encode64(padding: false)
      state = Phoenix.Token.encrypt(FamilyWeb.Endpoint, @salt, %{u: user.id, p: provider, v: verifier, a: account && account.id})
      challenge = :crypto.hash(:sha256, verifier) |> Base.url_encode64(padding: false)

      params =
        [
          response_type: "code",
          client_id: client_id,
          redirect_uri: redirect_uri(site, provider),
          scope: scope(provider),
          state: state,
          code_challenge: challenge,
          code_challenge_method: "S256"
        ] ++ extra(provider) ++ if(account && account.email, do: [login_hint: account.email], else: [])

      {:ok, authorize_url(provider) <> "?" <> URI.encode_query(params)}
    end
  end

  # Only the calendars themselves, and who's signing in, so they can see which account it is.
  defp scope("google"),
    do: "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events"

  defp scope("microsoft"), do: "openid email offline_access Calendars.ReadWrite"

  # Google only gives a token that lasts if it's asked for one, and only with the consent screen.
  defp extra("google"), do: [access_type: "offline", prompt: "consent", include_granted_scopes: "true"]
  defp extra("microsoft"), do: [prompt: "select_account"]

  defp authorize_url("google"), do: url(:google_accounts) <> "/o/oauth2/v2/auth"
  defp authorize_url("microsoft"), do: url(:microsoft_login) <> "/" <> tenant() <> "/oauth2/v2.0/authorize"

  defp token_url("google"), do: url(:google_oauth) <> "/token"
  defp token_url("microsoft"), do: url(:microsoft_login) <> "/" <> tenant() <> "/oauth2/v2.0/token"

  # "common" takes personal accounts (Outlook.com, Hotmail) and work or school ones.
  defp tenant, do: Application.get_env(:family, :microsoft_tenant, "common")

  @doc """
  Finishes signing in, when the provider sends someone back: checks it's
  the same person who set off, swaps the code for tokens and keeps them.
  Gives the account, whose calendars they then pick from.
  """
  def finish(nil, _provider, _site, _params),
    do: {:error, "Sign in to Kitchen Table in this browser first, then link the calendar again from there."}

  def finish(%User{} = user, provider, site, params) when provider in @providers do
    with {:ok, state} <- state(params["state"], provider, user),
         :ok <- refused(params, provider),
         {:ok, code} <- code(params, provider),
         {:ok, client_id, secret, _} <- ready(provider),
         {:ok, tokens} <-
           token_request(provider,
             grant_type: "authorization_code",
             code: code,
             redirect_uri: redirect_uri(site, provider),
             code_verifier: state.v,
             client_id: client_id,
             client_secret: secret
           ),
         {:ok, refresh} <- refresh_token(tokens, provider),
         {:ok, account} <- own(user, state.a, provider) do
      email = email_of(tokens)

      cond do
        account && account.email && email && String.downcase(account.email) != String.downcase(email) ->
          {:error, "That was #{email}, but these calendars are #{account.email}'s. Sign in again as #{account.email}."}

        true ->
          account = account || same_email(user, provider, email) || %Account{user_id: user.id, provider: provider}

          account
          |> Ecto.Changeset.change(
            email: email || account.email,
            secret: Vault.seal(refresh),
            access: Vault.seal(tokens["access_token"]),
            expires_at: expires_at(tokens)
          )
          |> Repo.insert_or_update()
          |> case do
            {:ok, saved} ->
              # Signing in again lets its calendars carry on straight away.
              Repo.update_all(from(l in Link, where: l.account_id == ^saved.id and not is_nil(l.last_error)), set: [last_synced_at: nil])
              {:ok, saved}

            error ->
              error
          end
      end
    end
  end

  defp state(token, provider, user) when is_binary(token) do
    case Phoenix.Token.decrypt(FamilyWeb.Endpoint, @salt, token, max_age: @state_age) do
      {:ok, %{u: id, p: ^provider} = state} when id == user.id -> {:ok, state}
      {:ok, %{u: _}} -> {:error, "This sign-in was started by someone else. Link the calendar again from your own Kitchen Table."}
      {:error, :expired} -> {:error, "That took a while, so it's timed out. Link the calendar again."}
      _ -> {:error, "Something went wrong signing in. Link the calendar again."}
    end
  end

  defp state(_, _, _), do: {:error, "Something went wrong signing in. Link the calendar again."}

  defp refused(%{"error" => "access_denied"}, provider), do: {:error, "You said no to #{name(provider)}, so nothing was linked."}

  defp refused(%{"error" => error} = params, provider) do
    Logger.warning("#{name(provider)} sign-in refused: #{error} #{String.slice(params["error_description"] || "", 0, 200)}")
    {:error, "#{name(provider)} wouldn't sign in (#{String.slice(error, 0, 60)}). An admin can check how it's set up under Linked calendars."}
  end

  defp refused(_, _), do: :ok

  defp code(%{"code" => code}, _) when is_binary(code) and code != "", do: {:ok, code}
  defp code(_, provider), do: {:error, "#{name(provider)} didn't say who signed in. Link the calendar again."}

  defp refresh_token(%{"refresh_token" => token}, _) when is_binary(token) and token != "", do: {:ok, token}
  defp refresh_token(_, provider), do: {:error, "#{name(provider)} didn't let the app stay signed in. Link the calendar again."}

  # Someone's own account, for signing in again; nil to sign in afresh.
  defp own(_user, nil, _provider), do: {:ok, nil}

  defp own(%User{id: user_id}, id, provider) do
    case Repo.get(Account, id) do
      %Account{user_id: ^user_id, provider: ^provider} = account -> {:ok, account}
      _ -> {:error, :not_found}
    end
  end

  defp same_email(_user, _provider, nil), do: nil

  defp same_email(user, provider, email) do
    Repo.one(from a in Account, where: a.user_id == ^user.id and a.provider == ^provider and a.email == ^email, limit: 1)
  end

  # Who signed in, from the ID token that came straight from the provider.
  defp email_of(%{"id_token" => token}) when is_binary(token) do
    with [_, payload, _] <- String.split(token, "."),
         {:ok, json} <- Base.url_decode64(payload, padding: false),
         {:ok, claims} <- Jason.decode(json) do
      present(claims["email"]) || present(claims["preferred_username"])
    else
      _ -> nil
    end
  end

  defp email_of(_), do: nil

  defp expires_at(tokens) do
    seconds = if is_integer(tokens["expires_in"]), do: tokens["expires_in"], else: 3600
    DateTime.add(DateTime.utc_now(:second), seconds)
  end

  defp ready(provider) do
    case client(provider) do
      {:ok, _, _, _} = ok -> ok
      :none -> {:error, "Signing in to #{name(provider)} isn't set up yet. An admin can set it up under Linked calendars."}
    end
  end

  ## Using an account

  @doc """
  An access token for an account, refreshed if it's run out. `:signed_out`
  when the provider won't refresh it, so the person needs to sign in again.
  """
  def token(%Account{} = account) do
    fresh = account.expires_at && DateTime.diff(account.expires_at, DateTime.utc_now(:second)) > 60

    case fresh && Vault.open(account.access) do
      {:ok, access} -> {:ok, access}
      _ -> refresh(account)
    end
  end

  defp refresh(%Account{provider: provider} = account) do
    with {:ok, refresh} <- Vault.open(account.secret) |> or_signed_out(),
         {:ok, client_id, secret, _} <- ready(provider),
         {:ok, tokens} <-
           token_request(
             provider,
             [grant_type: "refresh_token", refresh_token: refresh, client_id: client_id, client_secret: secret] ++
               if(provider == "microsoft", do: [scope: scope(provider)], else: [])
           ) do
      # Microsoft gives a new refresh token each time; Google keeps the first.
      changes = [access: Vault.seal(tokens["access_token"]), expires_at: expires_at(tokens)]
      changes = if is_binary(tokens["refresh_token"]), do: [{:secret, Vault.seal(tokens["refresh_token"])} | changes], else: changes
      Repo.update_all(from(a in Account, where: a.id == ^account.id), set: changes)
      {:ok, tokens["access_token"]}
    end
  end

  defp or_signed_out({:ok, _} = ok), do: ok
  defp or_signed_out(_), do: {:error, :signed_out}

  @doc "Forgets an access token the provider turned down, so the next use gets a new one."
  def stale(%Account{id: id}), do: Repo.update_all(from(a in Account, where: a.id == ^id), set: [access: nil, expires_at: nil])

  @doc "Forgets an account once none of its calendars is linked, and tells Google to forget the app's access."
  def forget(%Account{} = account) do
    Repo.delete_all(from a in Account, where: a.id == ^account.id)

    if account.provider == "google" do
      with {:ok, refresh} <- Vault.open(account.secret) do
        Task.start(fn -> post_form(url(:google_oauth) <> "/revoke", token: refresh) end)
      end
    end

    :ok
  end

  @doc "Forgets accounts someone signed in to but never linked a calendar from."
  def tidy do
    cutoff = DateTime.add(DateTime.utc_now(:second), -3600)
    unused = Repo.all(from a in Account, where: a.inserted_at < ^cutoff and a.id not in subquery(from l in Link, where: not is_nil(l.account_id), select: l.account_id))
    Enum.each(unused, &forget/1)
  end

  defp token_request(provider, form) do
    case post_form(token_url(provider), form) do
      {:ok, %{status: 200, body: body}} ->
        case Jason.decode(body) do
          {:ok, %{"access_token" => access} = tokens} when is_binary(access) -> {:ok, tokens}
          _ -> {:error, "#{name(provider)} sent something the app didn't understand. Try again in a minute."}
        end

      {:ok, %{status: status, body: body}} when status in 400..401 ->
        error = with {:ok, %{"error" => e}} <- Jason.decode(body), do: e, else: (_ -> "unknown")
        Logger.warning("#{name(provider)} token request: HTTP #{status} #{String.slice(error, 0, 80)}")

        case error do
          "invalid_grant" -> {:error, :signed_out}
          e when e in ["invalid_client", "unauthorized_client"] -> {:error, "#{name(provider)} didn't accept the app's client ID and secret. An admin can check them under Linked calendars."}
          _ -> {:error, "#{name(provider)} wouldn't sign in just now. Try again in a minute."}
        end

      {:ok, %{status: status}} ->
        Logger.warning("#{name(provider)} token request: HTTP #{status}")
        {:error, "#{name(provider)} couldn't be reached just now. Try again in a minute."}

      {:error, reason} ->
        Logger.warning("#{name(provider)} token request: #{inspect(reason) |> String.slice(0, 200)}")
        {:error, "#{name(provider)} couldn't be reached just now. Try again in a minute."}
    end
  end

  defp post_form(address, form) do
    HTTP.request("POST", URI.parse(address), [{"content-type", "application/x-www-form-urlencoded"}, {"accept", "application/json"}], URI.encode_query(form),
      timeout: 30_000,
      allow_private: Application.get_env(:family, :calendar_private_hosts, false)
    )
  end

  defp present(nil), do: nil
  defp present(s) when is_binary(s), do: if(String.trim(s) == "", do: nil, else: String.trim(s))
  defp present(_), do: nil
end
