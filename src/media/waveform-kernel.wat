;; The sample loops behind waveform summaries and mixes, four samples per
;; instruction. Compiled into src/generated/waveform-kernel.ts by
;; `npm run kernel:build`.
;;
;; Memory holds three regions, laid out by `setup` for chunks of up to `chunk`
;; samples: the accumulator a chunk is mixed into, the input a channel is
;; copied into before it is added, and the min/max pairs `reduce` writes.
(module
	(memory (export "memory") 1)
	(global $input (mut i32) (i32.const 0))
	(global $output (mut i32) (i32.const 0))

	(func (export "setup") (param $chunk i32)
		(global.set $input (i32.mul (local.get $chunk) (i32.const 4)))
		(global.set $output (i32.mul (local.get $chunk) (i32.const 8))))

	;; Zeroes the first `count` samples of the accumulator.
	(func (export "clear") (param $count i32)
		(memory.fill (i32.const 0) (i32.const 0) (i32.mul (local.get $count) (i32.const 4))))

	;; Adds `gain` times the first `count` input samples to the accumulator from
	;; sample `offset` on.
	(func (export "accumulate") (param $offset i32) (param $count i32) (param $gain f32)
		(local $target i32) (local $source i32) (local $end i32) (local $gains v128)
		(local.set $gains (f32x4.splat (local.get $gain)))
		(local.set $target (i32.mul (local.get $offset) (i32.const 4)))
		(local.set $source (global.get $input))
		(local.set $end
			(i32.add (global.get $input)
				(i32.mul (i32.and (local.get $count) (i32.const -4)) (i32.const 4))))
		(block $vectors_done
			(loop $vectors
				(br_if $vectors_done (i32.ge_u (local.get $source) (local.get $end)))
				(v128.store (local.get $target)
					(f32x4.add
						(v128.load (local.get $target))
						(f32x4.mul (v128.load (local.get $source)) (local.get $gains))))
				(local.set $target (i32.add (local.get $target) (i32.const 16)))
				(local.set $source (i32.add (local.get $source) (i32.const 16)))
				(br $vectors)))
		(local.set $end
			(i32.add (global.get $input) (i32.mul (local.get $count) (i32.const 4))))
		(block $tail_done
			(loop $tail
				(br_if $tail_done (i32.ge_u (local.get $source) (local.get $end)))
				(f32.store (local.get $target)
					(f32.add
						(f32.load (local.get $target))
						(f32.mul (f32.load (local.get $source)) (local.get $gain))))
				(local.set $target (i32.add (local.get $target) (i32.const 4)))
				(local.set $source (i32.add (local.get $source) (i32.const 4)))
				(br $tail))))

	;; Writes the min/max pair of every 16 accumulator samples among the first
	;; `count`, the last block taking whatever is left.
	(func (export "reduce") (param $count i32)
		(local $sample i32) (local $pair i32) (local $end i32)
		(local $mins v128) (local $maxes v128) (local $values v128)
		(local $value f32) (local $min f32) (local $max f32)
		(local.set $pair (global.get $output))
		(local.set $end
			(i32.mul (i32.and (local.get $count) (i32.const -16)) (i32.const 4)))
		(block $blocks_done
			(loop $blocks
				(br_if $blocks_done (i32.ge_u (local.get $sample) (local.get $end)))
				(local.set $mins (v128.load (local.get $sample)))
				(local.set $maxes (local.get $mins))
				(local.set $values (v128.load offset=16 (local.get $sample)))
				(local.set $mins (f32x4.pmin (local.get $mins) (local.get $values)))
				(local.set $maxes (f32x4.pmax (local.get $maxes) (local.get $values)))
				(local.set $values (v128.load offset=32 (local.get $sample)))
				(local.set $mins (f32x4.pmin (local.get $mins) (local.get $values)))
				(local.set $maxes (f32x4.pmax (local.get $maxes) (local.get $values)))
				(local.set $values (v128.load offset=48 (local.get $sample)))
				(local.set $mins (f32x4.pmin (local.get $mins) (local.get $values)))
				(local.set $maxes (f32x4.pmax (local.get $maxes) (local.get $values)))
				(f32.store (local.get $pair)
					(f32.min
						(f32.min
							(f32x4.extract_lane 0 (local.get $mins))
							(f32x4.extract_lane 1 (local.get $mins)))
						(f32.min
							(f32x4.extract_lane 2 (local.get $mins))
							(f32x4.extract_lane 3 (local.get $mins)))))
				(f32.store offset=4 (local.get $pair)
					(f32.max
						(f32.max
							(f32x4.extract_lane 0 (local.get $maxes))
							(f32x4.extract_lane 1 (local.get $maxes)))
						(f32.max
							(f32x4.extract_lane 2 (local.get $maxes))
							(f32x4.extract_lane 3 (local.get $maxes)))))
				(local.set $sample (i32.add (local.get $sample) (i32.const 64)))
				(local.set $pair (i32.add (local.get $pair) (i32.const 8)))
				(br $blocks)))
		(local.set $end (i32.mul (local.get $count) (i32.const 4)))
		(if (i32.lt_u (local.get $sample) (local.get $end))
			(then
				(local.set $min (f32.load (local.get $sample)))
				(local.set $max (local.get $min))
				(block $tail_done
					(loop $tail
						(local.set $sample (i32.add (local.get $sample) (i32.const 4)))
						(br_if $tail_done (i32.ge_u (local.get $sample) (local.get $end)))
						(local.set $value (f32.load (local.get $sample)))
						(local.set $min (f32.min (local.get $min) (local.get $value)))
						(local.set $max (f32.max (local.get $max) (local.get $value)))
						(br $tail)))
				(f32.store (local.get $pair) (local.get $min))
				(f32.store offset=4 (local.get $pair) (local.get $max))))))
