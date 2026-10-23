defmodule Family.Mailer do
  @moduledoc """
  Sends the app's few emails (invitations and new one-time passwords).

  Every email is kept in the outbox, which admins can read in the app. That
  is all that happens on a computer with no email set up. With SMTP settings
  it is also sent for real: from SMTP_* when the server starts (see
  config/runtime.exs), or else from an admin putting in a mailbox and its
  password above the outbox, where the password is sealed like a calendar's.
  """

  require Logger
  import Ecto.Query
  alias Family.{Permissions, Repo, Settings}
  alias Family.Accounts.User
  alias Family.Calendar.Vault

  defmodule Email do
    use Ecto.Schema

    schema "outbox" do
      field :to, :string
      field :subject, :string
      field :body, :string
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end

  def deliver(to, subject, body) do
    email = Repo.insert!(%Email{to: to, subject: subject, body: body})

    case smtp() do
      {:ok, smtp, _} ->
        Task.start(fn ->
          case client().send(smtp, to, subject, body) do
            :ok -> Logger.info("Sent \"#{subject}\" to #{to}")
            {:error, reason} -> Logger.error("Couldn't email #{to}: #{inspect(reason)}")
          end
        end)

      :none ->
        Logger.info("Email to #{to} kept in the outbox: #{subject}")
    end

    {:ok, email}
  end

  # Tests send through a stand-in.
  defp client, do: Application.get_env(:family, :smtp_client, Family.Mailer.SMTP)

  ## How email is sent

  @doc """
  The SMTP settings in use, and where they came from: `:server` (its own
  settings) or `:app` (an admin). `:none` keeps email in the outbox.
  """
  def smtp do
    if Application.get_env(:family, :mailer, :outbox) == :smtp do
      {:ok, Application.fetch_env!(:family, :smtp), :server}
    else
      with host when is_binary(host) <- Settings.get("smtp_host"),
           sealed when is_binary(sealed) <- Settings.get("smtp_password"),
           {:ok, raw} <- Base.decode64(sealed),
           {:ok, password} <- Vault.open(raw) do
        {:ok,
         [
           host: host,
           port: String.to_integer(Settings.get("smtp_port") || "587"),
           username: Settings.get("smtp_username"),
           password: password,
           from: Settings.get("smtp_from")
         ], :app}
      else
        _ -> :none
      end
    end
  end

  @doc "How email is sent, for an admin: never the password."
  def status(%User{} = user) do
    if Permissions.can?(user, :manage_people) do
      case smtp() do
        {:ok, s, source} -> {:ok, %{on: true, source: source, address: s[:username], from: s[:from], host: s[:host], port: s[:port]}}
        :none -> {:ok, %{on: false, source: nil, address: nil, from: nil, host: nil, port: nil}}
      end
    else
      {:error, :forbidden}
    end
  end

  @doc """
  An admin puts in a mailbox to send from: its address and password, and
  for anything but Gmail its server. A test email goes to the admin first,
  and the settings are kept only if it goes.
  """
  def setup(%User{} = user, attrs) do
    address = attrs |> Map.get("address") |> trimmed()
    gmail = is_binary(address) and String.match?(address, ~r/@(gmail|googlemail)\.com$/i)
    # Google shows app passwords in groups of four; the spaces aren't part of it.
    password = attrs |> Map.get("password") |> trimmed() |> then(&if(gmail and &1, do: String.replace(&1, " ", ""), else: &1))
    host = trimmed(attrs["host"]) || if(gmail, do: "smtp.gmail.com")
    port = attrs["port"] |> to_string() |> Integer.parse() |> then(&if(match?({p, ""} when p > 0 and p < 65_536, &1), do: elem(&1, 0), else: 587))
    from = trimmed(attrs["from"]) || "#{Application.get_env(:family, :app_name, "Kitchen Table")} <#{address}>"

    cond do
      not Permissions.can?(user, :manage_people) -> {:error, :forbidden}
      match?({:ok, _, :server}, smtp()) -> {:error, "This server's own settings say how to send email."}
      is_nil(address) or not String.contains?(address, "@") -> {:error, "Put in the email address to send from."}
      is_nil(password) -> {:error, "Put in the password for that address. For Gmail, it's an app password."}
      is_nil(host) -> {:error, "Put in the email server, such as smtp.example.com. Your email provider's help pages say what it is."}
      true ->
        smtp = [host: host, port: port, username: address, password: password, from: from]
        app = Application.get_env(:family, :app_name, "Kitchen Table")

        body = """
        Hello #{user.name},

        #{app} can send email now. Invitations and new one-time passwords will come from #{from}.
        """

        case client().send(smtp, user.email, "#{app} can send email", body) do
          :ok ->
            Settings.put("smtp_host", host)
            Settings.put("smtp_port", Integer.to_string(port))
            Settings.put("smtp_username", address)
            Settings.put("smtp_password", Base.encode64(Vault.seal(password)))
            Settings.put("smtp_from", from)
            Logger.info("Email is on, sending from #{address}")
            :ok

          {:error, reason} ->
            {:error, couldnt_send(reason, gmail)}
        end
    end
  end

  @doc "An admin stops sending email; it waits in the outbox again."
  def clear(%User{} = user) do
    if Permissions.can?(user, :manage_people) do
      Enum.each(~w(smtp_host smtp_port smtp_username smtp_password smtp_from), &Settings.delete/1)
      :ok
    else
      {:error, :forbidden}
    end
  end

  defp couldnt_send(reason, gmail) do
    text = if is_binary(reason), do: reason, else: inspect(reason)

    cond do
      text =~ ~r/^535|5\.7\.8|Username and Password/ and gmail ->
        "Gmail didn't accept that address and app password. Check the address, and make a new app password if need be."

      text =~ ~r/^535/ ->
        "The email server didn't accept that address and password."

      true ->
        "Couldn't send a test email: #{text}"
    end
  end

  defp trimmed(nil), do: nil
  defp trimmed(text) when is_binary(text), do: with("" <- String.trim(text), do: nil)
  defp trimmed(_), do: nil

  def outbox(limit \\ 50) do
    Email |> order_by(desc: :id) |> limit(^limit) |> Repo.all()
  end
end

defmodule Family.Mailer.SMTP do
  @moduledoc "A small SMTP client: STARTTLS on 587 or TLS on 465, then AUTH LOGIN."

  @timeout 15_000

  def send(opts, to, subject, body) do
    host = String.to_charlist(opts[:host])
    port = opts[:port]
    from = opts[:from]

    message = [
      "From: #{from}\r\n",
      "To: #{to}\r\n",
      "Subject: #{encode_subject(subject)}\r\n",
      "Date: #{Calendar.strftime(DateTime.utc_now(), "%a, %d %b %Y %H:%M:%S +0000")}\r\n",
      "Message-ID: <#{System.unique_integer([:positive])}.#{System.os_time()}@#{opts[:host]}>\r\n",
      "MIME-Version: 1.0\r\n",
      "Content-Type: text/plain; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      body |> String.replace(~r/\r?\n/, "\r\n") |> String.replace("\r\n.", "\r\n.."),
      "\r\n.\r\n"
    ]

    with {:ok, conn} <- connect(host, port),
         {:ok, conn} <- expect(conn, 220),
         {:ok, conn} <- command(conn, "EHLO family.local", 250),
         {:ok, conn} <- maybe_starttls(conn, host, port),
         {:ok, conn} <- auth(conn, opts[:username], opts[:password]),
         {:ok, conn} <- command(conn, "MAIL FROM:<#{address(from)}>", 250),
         {:ok, conn} <- command(conn, "RCPT TO:<#{to}>", 250),
         {:ok, conn} <- command(conn, "DATA", 354),
         :ok <- write(conn, message),
         {:ok, conn} <- expect(conn, 250) do
      command(conn, "QUIT", 221)
      close(conn)
      :ok
    end
  end

  defp connect(host, 465) do
    with {:ok, sock} <- :ssl.connect(host, 465, ssl_opts(host), @timeout), do: {:ok, {:ssl, sock}}
  end

  defp connect(host, port) do
    with {:ok, sock} <- :gen_tcp.connect(host, port, [:binary, active: false], @timeout),
         do: {:ok, {:tcp, sock}}
  end

  defp maybe_starttls({:tcp, sock} = conn, host, _port) do
    with {:ok, _} <- command(conn, "STARTTLS", 220),
         {:ok, tls} <- :ssl.connect(sock, ssl_opts(host), @timeout),
         conn = {:ssl, tls},
         {:ok, conn} <- command(conn, "EHLO family.local", 250) do
      {:ok, conn}
    end
  end

  defp maybe_starttls(conn, _, _), do: {:ok, conn}

  defp ssl_opts(host) do
    [
      verify: :verify_peer,
      cacerts: :public_key.cacerts_get(),
      server_name_indication: host,
      customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]
    ]
  end

  defp auth(conn, nil, _), do: {:ok, conn}

  defp auth(conn, user, pass) do
    with {:ok, conn} <- command(conn, "AUTH LOGIN", 334),
         {:ok, conn} <- command(conn, Base.encode64(user), 334) do
      command(conn, Base.encode64(pass), 235)
    end
  end

  defp command(conn, line, code) do
    with :ok <- write(conn, [line, "\r\n"]), do: expect(conn, code)
  end

  defp expect(conn, code) do
    case read_reply(conn, "") do
      {:ok, <<got::binary-size(3), _::binary>> = reply} ->
        if got == Integer.to_string(code), do: {:ok, conn}, else: {:error, String.trim(reply)}

      error ->
        error
    end
  end

  # Multi-line replies end with a line whose fourth character is a space.
  defp read_reply(conn, acc) do
    with {:ok, data} <- recv(conn) do
      acc = acc <> data
      lines = String.split(acc, "\r\n", trim: true)

      if String.ends_with?(acc, "\r\n") and match?(<<_::binary-size(3), " ", _::binary>>, List.last(lines) || ""),
        do: {:ok, List.last(lines)},
        else: read_reply(conn, acc)
    end
  end

  defp write({:tcp, s}, data), do: :gen_tcp.send(s, data)
  defp write({:ssl, s}, data), do: :ssl.send(s, data)
  defp recv({:tcp, s}), do: :gen_tcp.recv(s, 0, @timeout)
  defp recv({:ssl, s}), do: :ssl.recv(s, 0, @timeout)
  defp close({:tcp, s}), do: :gen_tcp.close(s)
  defp close({:ssl, s}), do: :ssl.close(s)

  defp address(from) do
    case Regex.run(~r/<([^>]+)>/, from) do
      [_, addr] -> addr
      _ -> from
    end
  end

  defp encode_subject(subject) do
    if subject =~ ~r/^[\x20-\x7E]*$/, do: subject, else: "=?UTF-8?B?#{Base.encode64(subject)}?="
  end
end
