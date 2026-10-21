defmodule Family.Push.WebPush do
  @moduledoc """
  Sends one notification to one browser through its push service (Google's
  for Chrome and Android, Mozilla's for Firefox, Apple's for iPhones and
  Macs). The message is encrypted for that browser alone (RFC 8291), so the
  push service can't read it, and the request is signed with the server's
  own key (VAPID, RFC 8292), so the service knows which server sent it.
  """

  alias Family.HTTP

  # The order of the P-256 curve: a private key has to be below it.
  @order 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
  @record_size 4096

  @doc """
  The server's key pair, made from its secret so it stays the same across
  restarts and needs nothing stored. Browsers subscribe with the public half.
  """
  def keys do
    secret = FamilyWeb.Endpoint.config(:secret_key_base)

    case :persistent_term.get(__MODULE__, nil) do
      {^secret, keys} ->
        keys

      _ ->
        keys = derive(secret, 0)
        :persistent_term.put(__MODULE__, {secret, keys})
        keys
    end
  end

  defp derive(secret, n) do
    private = Plug.Crypto.KeyGenerator.generate(secret, "web push key #{n}", length: 32)
    d = :binary.decode_unsigned(private)

    if d > 0 and d < @order do
      {public, _} = :crypto.generate_key(:ecdh, :prime256v1, private)
      %{public: public, private: private}
    else
      derive(secret, n + 1)
    end
  end

  def public_key, do: b64(keys().public)

  @doc """
  Sends `payload` (at most about 3,000 bytes) to a subscription, a map with
  the `endpoint`, `p256dh` and `auth` the browser gave. Gives `:ok`, `:gone`
  when the browser has dropped the subscription (so forget it), or
  `{:error, reason}`.

  Options: `:ttl` (seconds the push service keeps trying), `:urgency`
  ("high" wakes a phone at once), and `:topic`, which makes a newer message
  replace one still waiting for a phone that's off.
  """
  def send(sub, payload, opts \\ []) do
    with {:ok, ua_public} <- Base.url_decode64(sub.p256dh, padding: false),
         {:ok, auth} <- Base.url_decode64(sub.auth, padding: false) do
      uri = URI.parse(sub.endpoint)

      headers =
        [
          {"authorization", vapid(uri)},
          {"content-encoding", "aes128gcm"},
          {"content-type", "application/octet-stream"},
          {"ttl", to_string(Keyword.get(opts, :ttl, 86_400))},
          {"urgency", Keyword.get(opts, :urgency, "normal")},
          {"user-agent", "KitchenTable/1.0"}
        ] ++ if(topic = opts[:topic], do: [{"topic", topic}], else: [])

      private = Application.get_env(:family, :push_private_hosts, false)

      case HTTP.request("POST", uri, headers, encrypt(payload, ua_public, auth), timeout: 15_000, allow_private: private) do
        {:ok, %{status: s}} when s in 200..299 -> :ok
        {:ok, %{status: s}} when s in [404, 410] -> :gone
        {:ok, %{status: s, body: body}} -> {:error, {s, String.slice(body, 0, 200)}}
        {:error, reason} -> {:error, reason}
      end
    else
      _ -> :gone
    end
  end

  @doc """
  Encrypts a message for one browser (RFC 8291, in a single aes128gcm record
  of RFC 8188). The sender's one-off key pair and the salt can be given, to
  check against the RFC's worked example.
  """
  def encrypt(plaintext, ua_public, auth_secret, sender \\ nil, salt \\ nil) do
    {as_public, as_private} = sender || :crypto.generate_key(:ecdh, :prime256v1)
    salt = salt || :crypto.strong_rand_bytes(16)

    shared = :crypto.compute_key(:ecdh, ua_public, as_private, :prime256v1)
    ikm = hmac(hmac(auth_secret, shared), "WebPush: info" <> <<0>> <> ua_public <> as_public <> <<1>>)
    prk = hmac(salt, ikm)
    <<cek::binary-16, _::binary>> = hmac(prk, "Content-Encoding: aes128gcm" <> <<0, 1>>)
    <<nonce::binary-12, _::binary>> = hmac(prk, "Content-Encoding: nonce" <> <<0, 1>>)

    # 2 marks the last (here the only) record.
    {ciphertext, tag} = :crypto.crypto_one_time_aead(:aes_128_gcm, cek, nonce, plaintext <> <<2>>, <<>>, true)

    salt <> <<@record_size::32, byte_size(as_public)::8>> <> as_public <> ciphertext <> tag
  end

  @doc "Whether a browser's key is a real point on the curve, so encrypting for it will work."
  def valid_key?(<<4, _::binary-64>> = point) do
    _ = :crypto.compute_key(:ecdh, point, keys().private, :prime256v1)
    true
  rescue
    _ -> false
  end

  def valid_key?(_), do: false

  # A short-lived signed note saying this server sent the request.
  defp vapid(%URI{} = uri) do
    %{public: public, private: private} = keys()
    default_port = if uri.scheme == "https", do: 443, else: 80
    audience = "#{uri.scheme}://#{uri.host}" <> if(uri.port in [nil, default_port], do: "", else: ":#{uri.port}")

    claims = %{aud: audience, exp: System.system_time(:second) + 12 * 3600, sub: contact()}
    input = b64(Jason.encode!(%{typ: "JWT", alg: "ES256"})) <> "." <> b64(Jason.encode!(claims))

    # ES256 wants the signature's two numbers side by side, not wrapped in DER.
    der = :crypto.sign(:ecdsa, :sha256, input, [private, :prime256v1])
    {:"ECDSA-Sig-Value", r, s} = :public_key.der_decode(:"ECDSA-Sig-Value", der)

    "vapid t=#{input}.#{b64(<<r::unsigned-256, s::unsigned-256>>)}, k=#{b64(public)}"
  end

  # Push services want a way to reach whoever runs the server; the site's own
  # address does, and keeps anyone's email out of it.
  defp contact, do: Application.get_env(:family, :push_contact) || FamilyWeb.Endpoint.url()

  defp hmac(key, data), do: :crypto.mac(:hmac, :sha256, key, data)
  defp b64(bin), do: Base.url_encode64(bin, padding: false)
end
