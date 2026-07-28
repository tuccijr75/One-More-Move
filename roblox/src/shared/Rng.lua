--!strict

local UINT32 = 4294967296
local MASK16 = 0xFFFF

export type Generator = {
	_state: number,
	NextNumber: (self: Generator) -> number,
	NextInteger: (self: Generator, maximumExclusive: number) -> number,
}

local Generator = {}
Generator.__index = Generator

local function normalize(value: number): number
	return value % UINT32
end

local function imul32(left: number, right: number): number
	local leftLow = bit32.band(left, MASK16)
	local leftHigh = bit32.rshift(left, 16)
	local rightLow = bit32.band(right, MASK16)
	local rightHigh = bit32.rshift(right, 16)
	local lowProduct = leftLow * rightLow
	local crossProduct = leftHigh * rightLow + leftLow * rightHigh
	return normalize(lowProduct + bit32.lshift(crossProduct, 16))
end

function Generator.NextNumber(self: Generator): number
	self._state = normalize(self._state + 0x6D2B79F5)
	local value = self._state
	value = imul32(bit32.bxor(value, bit32.rshift(value, 15)), bit32.bor(value, 1))
	value = bit32.bxor(
		value,
		normalize(value + imul32(bit32.bxor(value, bit32.rshift(value, 7)), bit32.bor(value, 61)))
	)
	value = bit32.bxor(value, bit32.rshift(value, 14))
	return normalize(value) / UINT32
end

function Generator.NextInteger(self: Generator, maximumExclusive: number): number
	assert(maximumExclusive > 0, "maximumExclusive must be positive")
	return math.floor(self:NextNumber() * maximumExclusive)
end

local Rng = {}

function Rng.new(seed: number): Generator
	return setmetatable({
		_state = normalize(seed),
	}, Generator) :: any
end

return table.freeze(Rng)
