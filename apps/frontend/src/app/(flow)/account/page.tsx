/* Account: profile card (avatar, name, email) centered in the frame.
   Shell (stage, grid, fade, header) lives in (flow)/layout — this is the
   animated content only. The board is a client island; the frame shell
   stays a server component. */
import AccountBoard from "./board";

export default function AccountPage() {
  return (
    <>
      {/* intro: x112 y232 */}
      <div className="absolute left-[112px] top-[232px] w-[1056px]">
        <h1 className="text-[40px] font-normal leading-[52px] tracking-[-1.2px] text-[#f5f7f7]">
          Account
        </h1>
        <p className="mt-[8px] text-[18px] font-normal leading-[26px] text-[#c5cad3]">
          Who gaze is building for.
        </p>
      </div>

      <AccountBoard />
    </>
  );
}
