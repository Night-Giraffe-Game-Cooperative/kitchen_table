defmodule FamilyWeb.FallbackController do
  use Phoenix.Controller, formats: [:json]
  import Plug.Conn
  require Logger

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    errors =
      Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
        Enum.reduce(opts, msg, fn {key, value}, acc ->
          String.replace(acc, "%{#{key}}", to_string(value))
        end)
      end)

    message =
      errors
      |> Enum.map(fn {field, [msg | _]} -> "#{humanise(field)} #{msg}." end)
      |> Enum.join(" ")

    error(conn, 422, message, errors)
  end

  def call(conn, {:error, {:password, message}}), do: error(conn, 422, message)
  def call(conn, {:error, message}) when is_binary(message), do: error(conn, 422, message)
  def call(conn, {:error, :forbidden}), do: error(conn, 403, "You aren't allowed to do that.")
  def call(conn, {:error, :not_found}), do: error(conn, 404, "That isn't here any more.")
  def call(conn, nil), do: error(conn, 404, "That isn't here any more.")
  def call(conn, {:error, :conflict}), do: error(conn, 409, "Someone else moved first.")
  def call(conn, {:error, :last_admin}), do: error(conn, 422, "The family needs at least one admin.")
  def call(conn, {:error, :already_set_up}), do: error(conn, 409, "This family is already set up.")
  def call(conn, {:error, :invalid_quiet_hours}), do: error(conn, 422, "Quiet hours need a start and an end time.")

  def call(conn, {:error, :quiet_hours}),
    do: error(conn, 403, "It's quiet time, so you can't send messages until it ends.")

  def call(conn, {:error, {:crashed, _}}), do: error(conn, 500, "Something went wrong saving that.")
  def call(conn, {:error, other}) do
    Logger.warning("Unexpected error: #{inspect(other) |> String.slice(0, 200)}")
    error(conn, 422, "That didn't work. Try again in a minute.")
  end

  defp error(conn, status, message, fields \\ %{}) do
    conn |> put_status(status) |> json(%{error: message, fields: fields})
  end

  defp humanise(field), do: field |> to_string() |> String.replace("_", " ") |> String.capitalize()
end
