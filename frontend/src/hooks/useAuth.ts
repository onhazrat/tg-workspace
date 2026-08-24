import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  type BodyLoginLoginAccessToken as AccessToken,
  loginLoginAccessToken,
  type UserPublic,
  type UserRegister,
  usersReadUserMe,
  usersRegisterUser,
} from "@/client"
import { hasSession, TOKEN_STORAGE_KEY } from "@/lib/storage/scoped"
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

const isLoggedIn = () => hasSession()

const useAuth = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const { data: user } = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser"],
    // Wrapped, not passed directly: react-query calls a `queryFn` with its own
    // context object (`{queryKey, signal, client, …}`), and the generated
    // functions now take an options object whose `client` means something else
    // entirely. Passing the reference compiles under `legacy/axios` only
    // because that client ignored the argument.
    queryFn: () => usersReadUserMe(),
    enabled: isLoggedIn(),
  })

  const signUpMutation = useMutation({
    mutationFn: (data: UserRegister) => usersRegisterUser({ body: data }),
    onSuccess: (response) => {
      // The server answers the same way whether or not the address was already
      // registered, so this cannot claim an account was created. It shows what
      // the server actually said.
      showSuccessToast(response.message)
      navigate({ to: "/login" })
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })

  const login = async (data: AccessToken) => {
    const response = await loginLoginAccessToken({ body: data })
    localStorage.setItem(TOKEN_STORAGE_KEY, response.access_token)
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      navigate({ to: "/summarizer", search: { tab: "summary" } })
    },
    onError: handleError.bind(showErrorToast),
  })

  /**
   * Sign out, leaving nothing of this account behind on the machine.
   *
   * Removing the token used to be the whole of it, which meant every channel,
   * post, summary and log the previous person had loaded stayed in the query
   * cache, readable by the next one until a refetch happened to replace it.
   * `clear()` is the second half, and it has to run before the navigation so no
   * in-flight render can re-read the old data.
   *
   * Stored *preferences* are not cleared here on purpose — they are namespaced
   * per account (`lib/storage/scoped.ts`), so they are already unreachable to
   * anyone else, and dropping them would mean signing back in to a reset app.
   */
  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    queryClient.clear()
    navigate({ to: "/login" })
  }

  return {
    signUpMutation,
    loginMutation,
    logout,
    user,
  }
}

export { isLoggedIn }
export default useAuth
