defmodule Family.Calendar.Vault do
  @moduledoc """
  Seals the passwords of linked calendars, so the database alone doesn't give
  them away. The key comes from the server's secret_key_base, which is kept
  apart from the database (see config/runtime.exs).
  """

  alias Plug.Crypto.{KeyGenerator, MessageEncryptor}

  def seal(plain) when is_binary(plain), do: MessageEncryptor.encrypt(plain, key("secret"), key("signature"))

  def open(nil), do: :error

  def open(sealed) when is_binary(sealed) do
    case MessageEncryptor.decrypt(sealed, key("secret"), key("signature")) do
      {:ok, plain} -> {:ok, plain}
      :error -> :error
    end
  end

  defp key(use) do
    secret = FamilyWeb.Endpoint.config(:secret_key_base)
    KeyGenerator.generate(secret, "linked calendar password " <> use, length: 32)
  end
end
