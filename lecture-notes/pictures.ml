(* pictures.ml *)
(* EMAI in Polytopia: game scenes for the lecture notes *)

(* A scene is a small map with what stands and what is written on it.  *)
(* The functions below write a scene as JSON.  The game's own tile and *)
(* unit components draw it (app/scene.tsx), and the build takes the    *)
(* picture (the scene blocks of a note, lecture-notes/build.el).       *)

(* A note loads this file with    #use "pictures.ml";;                 *)

(* ********** *)

(* A mark is an arrow, an outline or a few words on the picture, to tie it to the code. *)

type mark =
  | Across of string                       (* an arrow over all the columns, above the map *)
  | Down of string                         (* an arrow over all the rows, left of the map  *)
  | Beside of (int * int) * string         (* an arrow to a tile, from the right of the map *)
  | Below of (int * int) * string          (* an arrow to a tile, from below the map *)
  | Outlined of (int * int) list * string  (* these tiles, tinted, and words for them *)
;;

let show_tile (x, y) =
  Printf.sprintf "(%d, %d)" x y;;

(* ********** *)

let json_of_list strings =
  "[" ^ String.concat "," strings ^ "]";;

let json_of_tile (x, y) =
  Printf.sprintf "[%d,%d]" x y;;

let json_of_mark mark =
  match mark with
  | Across text ->
     Printf.sprintf "{\"kind\":\"across\",\"text\":%S}" text
  | Down text ->
     Printf.sprintf "{\"kind\":\"down\",\"text\":%S}" text
  | Beside ((x, y), text) ->
     Printf.sprintf "{\"kind\":\"beside\",\"x\":%d,\"y\":%d,\"text\":%S}" x y text
  | Below ((x, y), text) ->
     Printf.sprintf "{\"kind\":\"below\",\"x\":%d,\"y\":%d,\"text\":%S}" x y text
  | Outlined (tiles, text) ->
     Printf.sprintf "{\"kind\":\"outlined\",\"tiles\":%s,\"text\":%S}"
       (json_of_list (List.map json_of_tile tiles)) text;;

(* ********** *)

(* scene rows                                                            *)
(*   rows:  the map, one string per row, one character per tile:         *)
(*          . field   F forest   M mountain   ~ water   V village        *)
(*   label: what to write on a tile, if anything                         *)
(*   path:  tiles joined by a line, in this order                        *)
(*   piece: a unit of the game on a tile, for example ("rider", (0, 5))  *)
(*   marks: arrows, outlines and words (see above)                       *)
(*   axes:  whether to number the columns and the rows                   *)
(* All the words must be plain ASCII.                                    *)

let scene ?(label = fun _ -> None) ?(path = []) ?piece ?(marks = []) ?(axes = false) rows =
  let height = Array.length rows
  in let width = if height = 0 then 0 else String.length rows.(0)
     and json_of_label p =
       match label p with
       | Some words -> Printf.sprintf "%S" words
       | None -> "null"
     in Printf.sprintf
          "{\"rows\":%s,\"labels\":%s,\"path\":%s,\"unit\":%s,\"marks\":%s,\"axes\":%b,\"tile\":64}"
          (json_of_list (List.map (Printf.sprintf "%S") (Array.to_list rows)))
          (json_of_list
             (List.init height (fun y ->
                  json_of_list (List.init width (fun x -> json_of_label (x, y))))))
          (json_of_list (List.map json_of_tile path))
          (match piece with
           | Some (kind, (x, y)) -> Printf.sprintf "{\"type\":%S,\"x\":%d,\"y\":%d}" kind x y
           | None -> "null")
          (json_of_list (List.map json_of_mark marks))
          axes;;

(* ********** *)

(* end of pictures.ml *)
