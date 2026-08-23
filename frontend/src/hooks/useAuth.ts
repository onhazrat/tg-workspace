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
import { handleError } from "@/utils"
import useCustomToast from "./useCustomToast"

const isLoggedIn = () => {
  return localStorage.getItem("access_token") !== null
}

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
    localStorage.setItem("access_token", response.access_token)
  }

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      navigate({ to: "/summarizer", search: { tab: "summary" } })
    },
    onError: handleError.bind(showErrorToast),
  })

  const logout = () => {
    localStorage.removeItem("access_token")
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
