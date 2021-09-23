#include <gtest/gtest.h>

template <typename T>
class TypedTestWithColon : public testing::Test
{
};

class MyTypeMapping
{
public:
    template <typename T>
    static std::string GetName(int i)
    {
        return std::string("foo::bar::") + std::to_string(i);
    }
};

using MyTypes = ::testing::Types<char, int, unsigned int>;
TYPED_TEST_SUITE(TypedTestWithColon, MyTypes, MyTypeMapping);

TYPED_TEST(TypedTestWithColon, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST(TypedTestWithColon, HasPropertyA)
{
    SUCCEED();
}
