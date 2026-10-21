defmodule Family.Accounts.Passwords do
  @moduledoc """
  PBKDF2-SHA256 password hashes, from Erlang's own crypto, so nothing needs a
  C compiler on Windows. Stored as `pbkdf2-sha256$iterations$salt$hash`.
  """

  @key_length 32

  def hash(password) when is_binary(password) do
    iterations = Application.get_env(:family, :password_iterations, 600_000)
    salt = :crypto.strong_rand_bytes(16)
    digest = :crypto.pbkdf2_hmac(:sha256, password, salt, iterations, @key_length)
    Enum.join(["pbkdf2-sha256", iterations, b64(salt), b64(digest)], "$")
  end

  def verify(password, stored) when is_binary(password) and is_binary(stored) do
    with ["pbkdf2-sha256", iterations, salt, digest] <- String.split(stored, "$"),
         {iterations, ""} <- Integer.parse(iterations),
         {:ok, salt} <- Base.url_decode64(salt, padding: false),
         {:ok, digest} <- Base.url_decode64(digest, padding: false) do
      candidate = :crypto.pbkdf2_hmac(:sha256, password, salt, iterations, byte_size(digest))
      :crypto.hash_equals(candidate, digest)
    else
      _ -> false
    end
  end

  def verify(_, _), do: false

  @doc "Spends the same time as a real check, so a wrong email takes as long as a wrong password."
  def no_user_verify do
    hash("not a real password")
    false
  end

  defp b64(bin), do: Base.url_encode64(bin, padding: false)

  @doc "A new password must be at least 8 characters."
  def validate_new(password) do
    cond do
      not is_binary(password) -> {:error, "Choose a new password."}
      String.length(password) < 8 -> {:error, "Use at least 8 characters."}
      String.length(password) > 200 -> {:error, "Use 200 characters or fewer."}
      true -> :ok
    end
  end
end
