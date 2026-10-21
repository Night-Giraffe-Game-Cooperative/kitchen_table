defmodule Family.FakePush do
  @moduledoc """
  A push service for tests, on this machine, standing in for Google's or
  Apple's. It hands each notification to the test that started it, and
  answers 410 Gone for addresses under /gone, as a real one does for a
  browser that has dropped its subscription.
  """

  import Plug.Conn

  def start(test_pid) do
    {:ok, server} = Bandit.start_link(plug: {__MODULE__, test_pid}, ip: :loopback, port: 0, startup_log: false)
    {:ok, {_ip, port}} = ThousandIsland.listener_info(server)
    {:ok, "http://127.0.0.1:#{port}"}
  end

  def init(test_pid), do: test_pid

  def call(conn, test_pid) do
    {:ok, body, conn} = read_body(conn)
    send(test_pid, {:push, conn.request_path, Map.new(conn.req_headers), body})
    if String.starts_with?(conn.request_path, "/gone"), do: send_resp(conn, 410, ""), else: send_resp(conn, 201, "")
  end

  @doc "A browser's side of a subscription: its key pair and auth secret."
  def browser do
    {public, private} = :crypto.generate_key(:ecdh, :prime256v1)
    %{public: public, private: private, auth: :crypto.strong_rand_bytes(16)}
  end

  def subscription(browser, endpoint) do
    %{
      "endpoint" => endpoint,
      "keys" => %{"p256dh" => Base.url_encode64(browser.public, padding: false), "auth" => Base.url_encode64(browser.auth, padding: false)}
    }
  end

  @doc "Opens a notification as the browser would (RFC 8291), and gives back its JSON."
  def decrypt(body, browser) do
    <<salt::binary-16, _rs::32, id_len::8, rest::binary>> = body
    <<as_public::binary-size(id_len), ciphertext::binary>> = rest
    shared = :crypto.compute_key(:ecdh, as_public, browser.private, :prime256v1)
    hmac = &:crypto.mac(:hmac, :sha256, &1, &2)
    ikm = hmac.(hmac.(browser.auth, shared), "WebPush: info" <> <<0>> <> browser.public <> as_public <> <<1>>)
    prk = hmac.(salt, ikm)
    <<cek::binary-16, _::binary>> = hmac.(prk, "Content-Encoding: aes128gcm" <> <<0, 1>>)
    <<nonce::binary-12, _::binary>> = hmac.(prk, "Content-Encoding: nonce" <> <<0, 1>>)
    size = byte_size(ciphertext) - 16
    <<data::binary-size(size), tag::binary-16>> = ciphertext
    plain = :crypto.crypto_one_time_aead(:aes_128_gcm, cek, nonce, data, <<>>, tag, false)
    plain |> String.trim_trailing(<<0>>) |> String.trim_trailing(<<2>>) |> Jason.decode!()
  end
end
