import { Redirect } from "expo-router";

/** rankings now live at the top of the Analyse page */
export default function RankingsRedirect() {
  return <Redirect href={"/analyse" as never} />;
}
